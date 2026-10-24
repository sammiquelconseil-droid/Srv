#!/usr/bin/env bash
# Cockpit — installe ou met à jour le bot Telegram personnel. Rejouable.
# Lancement : bash <(curl -fsSL https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main/b)
set -euo pipefail
RAW=https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main
[ "$(id -u)" = 0 ] || { echo "Lance-le en root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
command -v node > /dev/null || { apt-get update -qq; apt-get -y -qq install nodejs; }
node -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)' || { echo "Node trop ancien."; exit 1; }

id -u cockpit > /dev/null 2>&1 || useradd --system --home /var/lib/cockpit --shell /usr/sbin/nologin cockpit
install -d -m 750 -o cockpit -g cockpit /var/lib/cockpit /var/lib/cockpit/inbox
install -d -m 755 /opt/cockpit-bot /etc/cockpit
for f in bot.mjs core.mjs classify.mjs telegram.mjs sync.mjs; do curl -fsSL "$RAW/bot/$f" -o "/opt/cockpit-bot/$f"; done

if [ ! -f /etc/cockpit/bot.env ]; then
  read -rp "Colle le jeton du bot donné par BotFather, puis Entrée : " TOKEN < /dev/tty
  PAIR=$(tr -dc a-z0-9 < /dev/urandom | head -c 8)
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
# the health file is written by root's timer; let the bot read it
chmod 644 /var/lib/cockpit/sante.json 2> /dev/null || true
systemctl daemon-reload
systemctl enable --now cockpit-bot > /dev/null
systemctl restart cockpit-bot
sleep 2
systemctl is-active cockpit-bot && echo "BOT EN MARCHE" || { journalctl -u cockpit-bot -n 20 --no-pager; exit 1; }
echo
echo "Dans Telegram, envoie à ton bot exactement :  /start $PAIR"
