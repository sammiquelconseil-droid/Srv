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
D=/var/backups/cockpit; install -d -m 750 -g cockpit "$D"
f="$D/cockpit-$(date +%Y%m%d-%H%M).tar.age"
tar -C / --exclude=var/lib/cockpit/cle-a-remettre --exclude='var/lib/cockpit/tmp-*' \
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
fi
jq -n --arg d "$(date -Iseconds)" --arg f "$(basename "$f")" --argjson t "$size" --arg s "$sha" --argjson r "$distant" --arg e "$erreur" \
  '{date:$d, fichier:$f, taille:$t, sha256:$s, distant:$r, erreur:$e}' > /var/lib/cockpit/sauvegarde.json
chown cockpit:cockpit /var/lib/cockpit/sauvegarde.json
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
systemctl daemon-reload
systemctl enable --now cockpit-sauvegarde.timer > /dev/null
/usr/local/sbin/cockpit-sauvegarde || true

# --- Application Cockpit (écrans) ----------------------------------------------------------
RAW=https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main
install -d -m 755 "${APP_DIR:-/opt/cockpit-app}/app" "${APP_DIR:-/opt/cockpit-app}/src"
install -d -m 750 -o cockpit -g cockpit /var/lib/cockpit/data
APP=${APP_DIR:-/opt/cockpit-app}
stage=$(mktemp -d); mkdir -p "$stage/app" "$stage/src"
curl -fsSL -H 'Cache-Control: no-cache' "$RAW/cockpit-app/FILES" -o "$stage/FILES"
while read -r f; do
  [[ "$f" =~ ^(app|src)/[a-z]+\.mjs$ ]] || { echo "liste invalide : $f"; exit 1; }
  curl -fsSL -H 'Cache-Control: no-cache' "$RAW/cockpit-app/$f" -o "$stage/$f"
  node --check "$stage/$f"   # vérifié sous son vrai nom (.mjs), sinon Node refuse l'extension
done < "$stage/FILES"
while read -r f; do install -m 644 "$stage/$f" "$APP/$f"; done < "$stage/FILES"
rm -rf "$stage"

# Données : copiées depuis le dépôt privé cockpit (dossier/situation.json) avec le jeton du bot.
cat > /usr/local/sbin/cockpit-donnees <<'SH'
#!/usr/bin/env bash
set -uo pipefail
tok=$(cat /var/lib/cockpit/secrets/github 2> /dev/null) || { echo "pas de jeton"; exit 0; }
t=$(mktemp)
if curl -fsSL -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github.raw" \
     "https://api.github.com/repos/sammiquelconseil-droid/cockpit/contents/dossier/situation.json" -o "$t" && jq -e '.biens | length > 0' "$t" > /dev/null; then
  install -m 640 -o cockpit -g cockpit "$t" /var/lib/cockpit/data/situation.json
fi
rm -f "$t"
SH
chmod 755 /usr/local/sbin/cockpit-donnees
cat > /etc/systemd/system/cockpit-donnees.service <<'UNIT'
[Unit]
Description=Cockpit : copie des données depuis le dépôt privé
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cockpit-donnees
UNIT
cat > /etc/systemd/system/cockpit-donnees.timer <<'UNIT'
[Unit]
Description=Cockpit : données toutes les heures
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
UNIT
/usr/local/sbin/cockpit-donnees

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
ReadOnlyPaths=/var/lib/cockpit
ReadWritePaths=/var/lib/cockpit/data
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now cockpit-donnees.timer > /dev/null
systemctl enable cockpit-app > /dev/null
systemctl restart cockpit-app
sleep 2
systemctl is-active --quiet cockpit-app && echo "application en marche : $url"
