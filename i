#!/usr/bin/env bash
# Cockpit — installation du serveur (Debian, Hostinger KVM 1). Rejouable sans danger.
# Ne contient aucun secret. Lancement : bash <(curl -fsSL https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main/i)
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
step() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Lance-le en root."; exit 1; }
. /etc/os-release
[ "$ID" = debian ] || { echo "Prévu pour Debian, trouvé : $ID."; exit 1; }

step "1/6 Mises à jour"
hostnamectl set-hostname cockpit
timedatectl set-timezone Europe/Paris
apt-get update -qq
apt-get -y -qq full-upgrade
apt-get -y -qq install unattended-upgrades apt-listchanges needrestart ufw fail2ban \
  python3-systemd curl ca-certificates age sqlite3 jq

step "2/6 Mises à jour de sécurité automatiques (chaque nuit, redémarrage 04:30 si besoin)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52cockpit-upgrades <<'CONF'
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian,codename=${distro_codename},label=Debian-Security";
  "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
  "origin=Tailscale";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF

step "3/6 Réseau privé (Tailscale)"
command -v tailscale > /dev/null || curl -fsSL https://tailscale.com/install.sh | sh
if ! tailscale status > /dev/null 2>&1; then
  echo ">>> Recopie dans Safari l'adresse https://login.tailscale.com/... qui va s'afficher,"
  echo ">>> puis touche Connect. L'installation reprend toute seule ensuite."
  tailscale up --ssh --hostname=cockpit
fi

step "4/6 Pare-feu : tout fermé sauf le réseau privé"
ufw --force reset > /dev/null
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow in on tailscale0 > /dev/null
ufw allow 22/tcp > /dev/null   # temporaire : fermé après le test depuis l'iPhone
ufw --force enable > /dev/null

step "5/6 Blocage des essais de mots de passe"
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 4
bantime = 1d
CONF
systemctl enable --now fail2ban > /dev/null
systemctl restart fail2ban

step "6/6 Contrôle de santé quotidien"
install -d -m 700 /var/lib/cockpit
[ -f /var/lib/cockpit/installe-le ] || touch /var/lib/cockpit/installe-le
cat > /usr/local/bin/cockpit-sante <<'SH'
#!/usr/bin/env bash
# Écrit /var/lib/cockpit/sante.json ; le bot Telegram personnel le lira et n'alertera que si ok=false.
set -uo pipefail
now=$(date +%s)
# Dernier passage des mises à jour automatiques ; avant le premier passage, date d'installation.
last=0
for f in /var/lib/apt/periodic/unattended-upgrades-stamp /var/log/unattended-upgrades/unattended-upgrades.log /var/lib/cockpit/installe-le; do
  [ -f "$f" ] && { last=$(stat -c %Y "$f"); break; }
done
age_h=$(( (now - last) / 3600 ))
pending=$(apt-get -s -o Debug::NoLocking=1 upgrade 2> /dev/null | grep -ci '^Inst .*security' || true)
reboot_h=0
[ -f /var/run/reboot-required ] && reboot_h=$(( (now - $(stat -c %Y /var/run/reboot-required)) / 3600 ))
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
ts=$(tailscale status > /dev/null 2>&1 && echo true || echo false)
ok=true
{ [ "$age_h" -gt 48 ] || [ "$pending" -gt 0 ] || [ "$reboot_h" -gt 24 ] || [ "$disk" -gt 85 ] || [ "$ts" = false ]; } && ok=false
printf '{"date":"%s","ok":%s,"maj_il_y_a_h":%s,"securite_en_attente":%s,"redemarrage_en_attente_h":%s,"disque_pct":%s,"reseau_prive":%s}\n' \
  "$(date -Iseconds)" "$ok" "$age_h" "$pending" "$reboot_h" "$disk" "$ts" > /var/lib/cockpit/sante.json
SH
chmod 755 /usr/local/bin/cockpit-sante
cat > /etc/systemd/system/cockpit-sante.service <<'UNIT'
[Unit]
Description=Cockpit : contrôle de santé
[Service]
Type=oneshot
ExecStart=/usr/local/bin/cockpit-sante
UNIT
cat > /etc/systemd/system/cockpit-sante.timer <<'UNIT'
[Unit]
Description=Cockpit : contrôle de santé chaque matin
[Timer]
OnCalendar=*-*-* 07:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now cockpit-sante.timer > /dev/null
/usr/local/bin/cockpit-sante

echo
echo "INSTALLATION TERMINÉE"
echo "Adresse privée du serveur : $(tailscale ip -4 2> /dev/null || echo 'inconnue')"
cat /var/lib/cockpit/sante.json
