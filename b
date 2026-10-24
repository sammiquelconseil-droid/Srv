#!/usr/bin/env bash
# Cockpit — installe ou met à jour le bot Telegram personnel. Rejouable.
# Lancement : curl -fsSLo b https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main/b && bash b
set -euo pipefail
trap 'echo; echo "ÉCHEC à la ligne $LINENO : envoie une capture à Claude, ne relance rien."' ERR
RAW=https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main
[ "$(id -u)" = 0 ] || { echo "Lance-le en root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
command -v node > /dev/null || { apt-get update -qq; apt-get -y -qq install nodejs; }
node -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)' || { echo "Node trop ancien."; exit 1; }

id -u cockpit > /dev/null 2>&1 || useradd --system --home /var/lib/cockpit --shell /usr/sbin/nologin cockpit
install -d -m 750 -o cockpit -g cockpit /var/lib/cockpit /var/lib/cockpit/inbox
install -d -m 755 /opt/cockpit-bot /etc/cockpit

# Mise à jour du bot, déclenchée depuis Telegram (/maj puis Valider) : le bot dépose une demande,
# root télécharge, vérifie la version et la syntaxe, installe et redémarre. Aucun droit root pour le bot.
cat > /usr/local/sbin/cockpit-maj <<'SH'
#!/usr/bin/env bash
set -uo pipefail
RAW=https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main
REQ=/var/lib/cockpit/maj-demandee; RES=/var/lib/cockpit/maj-resultat
[ -f "$REQ" ] || exit 0
want=$(tr -dc 'A-Za-z0-9.-' < "$REQ"); rm -f "$REQ"
fail() { echo "$1" > "$RES"; chown cockpit:cockpit "$RES"; systemctl restart cockpit-bot; exit 0; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSL -H 'Cache-Control: no-cache' "$RAW/VERSION" -o "$tmp/VERSION" || fail "téléchargement impossible"
curl -fsSL -H 'Cache-Control: no-cache' "$RAW/bot/FILES" -o "$tmp/FILES" || fail "téléchargement impossible"
[ "$(tr -d '[:space:]' < "$tmp/VERSION")" = "$want" ] || fail "la version publiée a changé entre-temps, réessaie dans 5 minutes"
while read -r f; do
  [[ "$f" =~ ^[a-z]+\.mjs$ ]] || fail "liste de fichiers invalide"
  curl -fsSL -H 'Cache-Control: no-cache' "$RAW/bot/$f" -o "$tmp/$f" || fail "téléchargement impossible"
  node --check "$tmp/$f" 2> /dev/null || fail "fichier $f invalide"
done < "$tmp/FILES"
rm -rf /opt/cockpit-bot.prev && cp -a /opt/cockpit-bot /opt/cockpit-bot.prev
install -m 644 "$tmp"/*.mjs "$tmp/VERSION" /opt/cockpit-bot/
echo "ok $want" > "$RES"; chown cockpit:cockpit "$RES"
systemctl restart cockpit-bot; sleep 8
if ! systemctl is-active --quiet cockpit-bot; then
  rm -rf /opt/cockpit-bot && cp -a /opt/cockpit-bot.prev /opt/cockpit-bot
  echo "le nouveau bot ne démarrait pas, l'ancienne version a été remise" > "$RES"; chown cockpit:cockpit "$RES"
  systemctl restart cockpit-bot
fi
SH
chmod 755 /usr/local/sbin/cockpit-maj
cat > /etc/systemd/system/cockpit-maj.path <<'UNIT'
[Unit]
Description=Cockpit : demande de mise à jour du bot
[Path]
PathExists=/var/lib/cockpit/maj-demandee
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/cockpit-maj.service <<'UNIT'
[Unit]
Description=Cockpit : mise à jour du bot
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cockpit-maj
UNIT

# Fichiers du bot
curl -fsSL "$RAW/VERSION" -o /opt/cockpit-bot/VERSION
curl -fsSL "$RAW/bot/FILES" -o /tmp/cockpit-files
while read -r f; do [[ "$f" =~ ^[a-z]+\.mjs$ ]] && curl -fsSL "$RAW/bot/$f" -o "/opt/cockpit-bot/$f"; done < /tmp/cockpit-files
rm -f /tmp/cockpit-files

if [ ! -f /etc/cockpit/bot.env ]; then
  read -rp "Colle le jeton du bot donné par BotFather, puis Entrée : " TOKEN < /dev/tty
  PAIR=$(od -An -N4 -tx1 /dev/urandom | tr -d " \n")
  umask 077
  printf 'TELEGRAM_BOT_TOKEN=%s\nPAIR_CODE=%s\nSTATE_DIR=/var/lib/cockpit\n' "$TOKEN" "$PAIR" > /etc/cockpit/bot.env
  chown root:cockpit /etc/cockpit/bot.env; chmod 640 /etc/cockpit/bot.env
  unset TOKEN
fi
PAIR=$(sed -n 's/^PAIR_CODE=//p' /etc/cockpit/bot.env)

cat > /etc/systemd/system/cockpit-bot.service <<'UNIT'
[Unit]
Description=Cockpit : bot Telegram personnel de Sam
After=network-online.target tailscaled.service
Wants=network-online.target
[Service]
User=cockpit
Group=cockpit
EnvironmentFile=/etc/cockpit/bot.env
WorkingDirectory=/opt/cockpit-bot
ExecStart=/usr/bin/node /opt/cockpit-bot/bot.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/cockpit
[Install]
WantedBy=multi-user.target
UNIT
chmod 644 /var/lib/cockpit/sante.json 2> /dev/null || true
systemctl daemon-reload
systemctl enable --now cockpit-maj.path > /dev/null
systemctl enable --now cockpit-bot > /dev/null
systemctl restart cockpit-bot
sleep 2
systemctl is-active cockpit-bot > /dev/null && echo "BOT EN MARCHE (version $(cat /opt/cockpit-bot/VERSION))" || { journalctl -u cockpit-bot -n 20 --no-pager; exit 1; }
[ -s /var/lib/cockpit/bot-state.json ] && grep -q '"owner"' /var/lib/cockpit/bot-state.json && echo "Déjà jumelé : rien à faire dans Telegram." || { echo; echo "Dans Telegram, envoie à ton bot exactement :  /start $PAIR"; }
