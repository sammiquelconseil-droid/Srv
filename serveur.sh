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
