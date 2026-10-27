#!/usr/bin/env bash
# Réglages du serveur appliqués par /maj (en root, après « Valider »). Rejouable sans danger.
set -euo pipefail
echo "== serveur.sh $(date -Iseconds)"
export DEBIAN_FRONTEND=noninteractive
command -v age > /dev/null || { apt-get update -qq; apt-get -y -qq install age; }
command -v jq > /dev/null || apt-get -y -qq install jq

# --- Sauvegardes chiffrées ------------------------------------------------------------
# Clé : créée une seule fois sur le serveur. La partie publique reste ici (elle ne sait que chiffrer).
# La partie secrète est remise à Sam par le bot, puis effacée du serveur quand il confirme.
install -d -m 755 /etc/cockpit
if [ ! -f /etc/cockpit/sauvegarde.pub ]; then
  umask 077
  age-keygen -o /var/lib/cockpit/cle-a-remettre 2> /dev/null
  age-keygen -y /var/lib/cockpit/cle-a-remettre > /etc/cockpit/sauvegarde.pub
  chown cockpit:cockpit /var/lib/cockpit/cle-a-remettre; chmod 600 /var/lib/cockpit/cle-a-remettre
  chmod 644 /etc/cockpit/sauvegarde.pub
  umask 022
fi

cat > /usr/local/sbin/cockpit-sauvegarde <<'SH'
#!/usr/bin/env bash
# Sauvegarde chiffrée : 14 copies sur le serveur + copie hors du serveur (dépôt privé cockpit,
# branche « sauvegardes »), relue et comparée à chaque fois. Résultat dans /var/lib/cockpit/sauvegarde.json.
set -uo pipefail
# Une seule sauvegarde à la fois (la nuit et « après modification » peuvent tomber ensemble).
exec 9> /run/cockpit-sauvegarde.lock; flock 9
# R : état gardé par root seul. Les fichiers lus par l'appli sont écrits ici puis déplacés d'un coup dans
# /var/lib/cockpit (mv remplace un éventuel lien au lieu de le suivre : root ne touche jamais un lien posé là).
R=/var/lib/cockpit-sauvegarde; install -d -m 700 "$R"
publish() { chown -h cockpit:cockpit "$1"; chmod 640 "$1"; mv -fT "$1" "/var/lib/cockpit/$2"; }
D=/var/backups/cockpit; install -d -m 750 -g cockpit "$D"
f="$D/cockpit-$(date +%Y%m%d-%H%M).tar.age"
tar -C / --exclude=var/lib/cockpit/cle-a-remettre --exclude='var/lib/cockpit/tmp-*' --exclude=var/lib/cockpit/coffre \
  -cf - etc/cockpit var/lib/cockpit 2> /dev/null | age -R /etc/cockpit/sauvegarde.pub -o "$f" || { echo "échec du chiffrement"; exit 1; }
chgrp cockpit "$f"; chmod 640 "$f"
ls -1t "$D"/*.tar.age | tail -n +15 | xargs -r rm -f
sha=$(sha256sum "$f" | cut -d' ' -f1); size=$(stat -c %s "$f")
distant=false; erreur=""
tok=$(cat /var/lib/cockpit/secrets/github 2> /dev/null || true)
if [ -z "$tok" ]; then erreur="pas de jeton GitHub"; else
  api=https://api.github.com/repos/sammiquelconseil-droid/cockpit
  H=(-H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json")
  if ! curl -fsS "${H[@]}" "$api/git/ref/heads/sauvegardes" > /dev/null 2>&1; then
    base=$(curl -fsS "${H[@]}" "$api/git/ref/heads/main" | jq -r .object.sha)
    curl -fsS "${H[@]}" -X POST "$api/git/refs" -d "{\"ref\":\"refs/heads/sauvegardes\",\"sha\":\"$base\"}" > /dev/null || erreur="branche impossible à créer"
  fi
  p=sauvegardes/cockpit-derniere.tar.age
  old=$(curl -fsS "${H[@]}" "$api/contents/$p?ref=sauvegardes" 2> /dev/null | jq -r '.sha // empty')
  body=$(mktemp); trap 'rm -f "$body"' EXIT
  jq -n --arg m "Sauvegarde chiffrée $(date +%d/%m) [skip ci] [skip render] [skip netlify]" --rawfile c <(base64 -w0 "$f") --arg s "$old" \
    '{message:$m, content:$c, branch:"sauvegardes"} + (if $s == "" then {} else {sha:$s} end)' > "$body"
  if curl -fsS "${H[@]}" -X PUT "$api/contents/$p" --data @"$body" > /dev/null; then
    back=$(curl -fsSL "${H[@]}" -H "Accept: application/vnd.github.raw" "$api/contents/$p?ref=sauvegardes" | sha256sum | cut -d' ' -f1)
    [ "$back" = "$sha" ] && distant=true || erreur="copie distante différente"
  else erreur="${erreur:-envoi vers GitHub refusé}"; fi
  # Coffre : chaque papier (déjà chiffré par l'appli) est rechiffré avec la clé de sauvegarde et envoyé UNE fois,
  # à part, pour que la sauvegarde de chaque nuit reste petite. Liste des papiers copiés : $R/coffre-distant.json
  # (vidée par /nouvelle_cle : tout est alors renvoyé, chiffré avec la nouvelle clé, en remplaçant l'ancienne copie).
  dist="$R/coffre-distant.json"
  jq -e '.ids | type == "array"' "$dist" > /dev/null 2>&1 || echo '{"ids":[]}' > "$dist"
  for doc in /var/lib/cockpit/coffre/*.ckf; do
    [ -e "$doc" ] || break
    id=$(basename "$doc" .ckf)
    [[ "$id" =~ ^[a-f0-9]{24}$ ]] || continue
    jq -e --arg i "$id" '.ids | index($i)' "$dist" > /dev/null && continue
    enc="$R/envoi.age"; rm -f "$enc"
    if age -R /etc/cockpit/sauvegarde.pub -o "$enc" "$doc"; then
      old=$(curl -fsS "${H[@]}" "$api/contents/sauvegardes/coffre/$id.age?ref=sauvegardes" 2> /dev/null | jq -r '.sha // empty')
      jq -n --arg m "Coffre $(date +%d/%m) [skip ci] [skip render] [skip netlify]" --rawfile c <(base64 -w0 "$enc") --arg s "$old" \
        '{message:$m, content:$c, branch:"sauvegardes"} + (if $s == "" then {} else {sha:$s} end)' > "$body"
      if curl -fsS "${H[@]}" -X PUT "$api/contents/sauvegardes/coffre/$id.age" --data @"$body" > /dev/null; then
        jq --arg i "$id" '.ids += [$i]' "$dist" > "$dist.tmp" && mv -f "$dist.tmp" "$dist"
      fi
    fi
    rm -f "$enc"
  done
fi
manquants=0
for doc in /var/lib/cockpit/coffre/*.ckf; do
  [ -e "$doc" ] || break
  jq -e --arg i "$(basename "$doc" .ckf)" '.ids | index($i)' "$R/coffre-distant.json" > /dev/null 2>&1 || manquants=$((manquants + 1))
done
[ -f "$R/coffre-distant.json" ] && cp "$R/coffre-distant.json" "$R/pub-coffre.json" && publish "$R/pub-coffre.json" coffre-distant.json
jq -n --arg d "$(date -Iseconds)" --arg f "$(basename "$f")" --argjson t "$size" --arg s "$sha" --argjson r "$distant" --arg e "$erreur" --argjson c "$manquants" \
  '{date:$d, fichier:$f, taille:$t, sha256:$s, distant:$r, erreur:$e, coffre_manquants:$c}' > "$R/pub-sauvegarde.json"
publish "$R/pub-sauvegarde.json" sauvegarde.json
echo "sauvegarde $(basename "$f") distant=$distant $erreur"
SH
chmod 755 /usr/local/sbin/cockpit-sauvegarde
cat > /etc/systemd/system/cockpit-sauvegarde.service <<'UNIT'
[Unit]
Description=Cockpit : sauvegarde chiffrée
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cockpit-sauvegarde
UNIT
# Sauvegarde aussitôt après une modification du dossier depuis la page « Dossier » (l'appli dépose un marqueur ;
# root efface le marqueur puis fait la sauvegarde chiffrée et l'envoie hors du serveur).
cat > /etc/systemd/system/cockpit-sauvegarde-demandee.path <<'UNIT'
[Unit]
Description=Cockpit : sauvegarde demandée après une modification du dossier
[Path]
PathExists=/var/lib/cockpit/data/sauvegarde-demandee
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/cockpit-sauvegarde-demandee.service <<'UNIT'
[Unit]
Description=Cockpit : sauvegarde après modification du dossier
[Service]
Type=oneshot
ExecStartPre=/bin/rm -f /var/lib/cockpit/data/sauvegarde-demandee
ExecStart=/usr/local/sbin/cockpit-sauvegarde
UNIT
cat > /etc/systemd/system/cockpit-sauvegarde.timer <<'UNIT'
[Unit]
Description=Cockpit : sauvegarde chiffrée chaque nuit
[Timer]
OnCalendar=*-*-* 03:15
Persistent=true
RandomizedDelaySec=10m
[Install]
WantedBy=timers.target
UNIT
# Renouvellement de la clé de sauvegarde demandé depuis Telegram (/nouvelle_cle + Valider)
cat > /usr/local/sbin/cockpit-nouvelle-cle <<'SH'
#!/usr/bin/env bash
set -euo pipefail
REQ=/var/lib/cockpit/cle-demandee
[ -f "$REQ" ] || exit 0
rm -f "$REQ"
umask 077
age-keygen -o /var/lib/cockpit/cle-a-remettre 2> /dev/null
age-keygen -y /var/lib/cockpit/cle-a-remettre > /etc/cockpit/sauvegarde.pub
chown cockpit:cockpit /var/lib/cockpit/cle-a-remettre; chmod 600 /var/lib/cockpit/cle-a-remettre; chmod 644 /etc/cockpit/sauvegarde.pub
rm -f /var/lib/cockpit/bot-state-keysent
# Nouvelle clé : les papiers du coffre déjà copiés hors du serveur l'étaient avec l'ancienne clé. On vide la liste
# pour qu'ils soient tous renvoyés (et remplacés) avec la nouvelle.
install -d -m 700 /var/lib/cockpit-sauvegarde; echo '{"ids":[]}' > /var/lib/cockpit-sauvegarde/coffre-distant.json
/usr/local/sbin/cockpit-sauvegarde || true
SH
chmod 755 /usr/local/sbin/cockpit-nouvelle-cle
cat > /etc/systemd/system/cockpit-nouvelle-cle.path <<'UNIT'
[Unit]
Description=Cockpit : demande de nouvelle clé de sauvegarde
[Path]
PathExists=/var/lib/cockpit/cle-demandee
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/cockpit-nouvelle-cle.service <<'UNIT'
[Unit]
Description=Cockpit : nouvelle clé de sauvegarde
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cockpit-nouvelle-cle
UNIT
systemctl daemon-reload
systemctl enable --now cockpit-nouvelle-cle.path > /dev/null
systemctl enable --now cockpit-sauvegarde.timer > /dev/null
systemctl enable --now cockpit-sauvegarde-demandee.path > /dev/null
/usr/local/sbin/cockpit-sauvegarde || true

# --- Application Cockpit (écrans) ----------------------------------------------------------
RAW=https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main
install -d -m 755 "${APP_DIR:-/opt/cockpit-app}/app" "${APP_DIR:-/opt/cockpit-app}/src"
install -d -m 750 -o cockpit -g cockpit /var/lib/cockpit/data
# Coffre (papiers de Sam) : fichiers chiffrés par l'appli dans /var/lib/cockpit/coffre ; leur clé est rangée hors du
# dossier de données, lisible par l'appli seulement (C-102). Créée une seule fois ; elle voyage dans la sauvegarde chiffrée.
install -d -m 700 -o cockpit -g cockpit /var/lib/cockpit/coffre
if [ ! -f /etc/cockpit/coffre.key ]; then (umask 077; head -c 32 /dev/urandom > /etc/cockpit/coffre.key); fi
chown root:cockpit /etc/cockpit/coffre.key; chmod 640 /etc/cockpit/coffre.key
APP=${APP_DIR:-/opt/cockpit-app}
stage=$(mktemp -d); mkdir -p "$stage/app" "$stage/src"
curl -fsSL -H 'Cache-Control: no-cache' "$RAW/cockpit-app/FILES" -o "$stage/FILES"
while read -r f; do
  [[ "$f" =~ ^(app|src)/[a-z]+\.mjs$ ]] || { echo "liste invalide : $f"; exit 1; }
  curl -fsSL -H 'Cache-Control: no-cache' "$RAW/cockpit-app/$f" -o "$stage/$f"
  node --check "$stage/$f"   # vérifié sous son vrai nom (.mjs), sinon Node refuse l'extension
done < "$stage/FILES"
# Alarme d'intégrité (C-113) : empreintes des fichiers que /maj installe, gardées par root seul. Chaque heure, root
# les recompare : un fichier changé, ajouté ou disparu en dehors de /maj = alerte du bot (« n'ouvre pas ton coffre »).
# Le verrou empêche le contrôle de tomber au milieu de l'installation (fausse alerte).
install -d -m 700 /var/lib/cockpit-integrite
exec 8> /var/lib/cockpit-integrite/verrou; flock 8
# Installation coupée au milieu (disque plein…) : le bot dit « mise à jour interrompue », pas « intrus ».
trap 'touch /var/lib/cockpit-integrite/maj-interrompue' ERR
while read -r f; do install -m 644 "$stage/$f" "$APP/$f"; done < "$stage/FILES"
# Seuls les fichiers de la liste restent : un .mjs en trop (ancien, ou posé par quelqu'un) est retiré.
for f in "$APP"/app/*.mjs "$APP"/src/*.mjs; do grep -qxF "${f#"$APP"/}" "$stage/FILES" || rm -f "$f"; done
(cd "$APP" && xargs sha256sum < "$stage/FILES") > /var/lib/cockpit-integrite/attendu.tmp
mv -f /var/lib/cockpit-integrite/attendu.tmp /var/lib/cockpit-integrite/attendu
rm -f /var/lib/cockpit-integrite/maj-interrompue
trap - ERR
rm -rf "$stage"
flock -u 8
cat > /usr/local/sbin/cockpit-integrite <<'SH'
#!/usr/bin/env bash
set -uo pipefail
APP=/opt/cockpit-app; W=/var/lib/cockpit-integrite
[ -f "$W/attendu" ] || exit 0
exec 9> "$W/verrou"; flock -n 9 || exit 0   # une mise à jour est en train d'installer : on repasse dans une heure
cd "$APP" || exit 0
bad=$(sha256sum --quiet -c "$W/attendu" 2> /dev/null | sed 's/: .*//' | tr '\n' ' ')
extra=$(comm -13 <(awk '{print $2}' "$W/attendu" | sort) <(ls app/*.mjs src/*.mjs 2> /dev/null | sort) | tr '\n' ' ')
ok=true; [ -n "$bad$extra" ] && ok=false
cause=""; [ -f "$W/maj-interrompue" ] && { ok=false; cause=maj; }   # installation coupée : pas un intrus
t=$(mktemp "$W/r.XXXXXX")
jq -n --arg d "$(date -Iseconds)" --argjson ok "$ok" --arg f "$bad$extra" --arg c "$cause" '{date: $d, ok: $ok, fichiers: $f, cause: $c}' > "$t" || { rm -f "$t"; exit 1; }
# Lisible par le bot (groupe), modifiable par root seul ; -T : un lien posé là est remplacé, jamais suivi.
chown -h root:cockpit "$t"; chmod 640 "$t"; mv -fT "$t" /var/lib/cockpit/integrite.json
SH
chmod 755 /usr/local/sbin/cockpit-integrite
cat > /etc/systemd/system/cockpit-integrite.service <<'UNIT'
[Unit]
Description=Cockpit : contrôle d'intégrité du code
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cockpit-integrite
UNIT
cat > /etc/systemd/system/cockpit-integrite.timer <<'UNIT'
[Unit]
Description=Cockpit : contrôle d'intégrité chaque heure
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now cockpit-integrite.timer > /dev/null
/usr/local/sbin/cockpit-integrite || true

# Données : le dossier (biens, crédits, loyers) vit SEULEMENT sur ce serveur, dans /var/lib/cockpit/data/situation.json,
# édité depuis la page « Dossier » et chiffré dans les sauvegardes. Il n'est plus copié depuis GitHub (C-094, 26/10/2026) :
# l'ancienne copie horaire est retirée. Le fichier déjà présent est gardé tel quel.
systemctl disable --now cockpit-donnees.timer > /dev/null 2>&1 || true
rm -f /etc/systemd/system/cockpit-donnees.timer /etc/systemd/system/cockpit-donnees.service /usr/local/sbin/cockpit-donnees
systemctl daemon-reload
if [ -f /var/lib/cockpit/data/situation.json ]; then chown cockpit:cockpit /var/lib/cockpit/data/situation.json; chmod 600 /var/lib/cockpit/data/situation.json; fi

# Adresse : https via « tailscale serve » si la fonction est activée sur le réseau privé,
# sinon l'application écoute directement sur l'adresse privée du serveur (jamais sur internet).
url=""; host=127.0.0.1
if timeout 25 tailscale serve --bg --https=443 http://127.0.0.1:8080 > /tmp/ts-serve.log 2>&1; then
  url="https://$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
  rm -f /var/lib/cockpit/serve-a-activer
else
  timeout 10 tailscale serve reset > /dev/null 2>&1 || true
  grep -o 'https://login.tailscale.com/[^ ]*' /tmp/ts-serve.log | head -1 > /var/lib/cockpit/serve-a-activer || true
  chown cockpit:cockpit /var/lib/cockpit/serve-a-activer 2> /dev/null || true
  host=$(tailscale ip -4 | head -1); url="http://$host:8080"
fi
rm -f /tmp/ts-serve.log
echo "$url" > /var/lib/cockpit/url; chown cockpit:cockpit /var/lib/cockpit/url
rpid=""; [[ "$url" == https://* ]] && rpid=${url#https://}
printf 'HOST=%s\nPORT=8080\nSTATE_DIR=/var/lib/cockpit\nRP_ID=%s\n' "$host" "$rpid" > /etc/cockpit/app.env

cat > /etc/systemd/system/cockpit-app.service <<'UNIT'
[Unit]
Description=Cockpit : écrans (réseau privé uniquement)
After=network-online.target tailscaled.service
Wants=network-online.target
[Service]
User=cockpit
Group=cockpit
EnvironmentFile=/etc/cockpit/app.env
WorkingDirectory=/opt/cockpit-app
ExecStart=/usr/bin/node /opt/cockpit-app/app/server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/cockpit
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable cockpit-app > /dev/null
systemctl restart cockpit-app
sleep 2
systemctl is-active --quiet cockpit-app && echo "application en marche : $url"
