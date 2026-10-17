#!/usr/bin/env bash
set -euo pipefail

TERRARIA_VERSION="1456"
TERRARIA_URL="https://terraria.org/api/download/pc-dedicated-server/terraria-server-${TERRARIA_VERSION}.zip"
INSTALL_DIR="/opt/terraria"
DATA_DIR="/var/lib/terraria"
CONFIG_DIR="/etc/terraria"
SERVICE_FILE="/etc/systemd/system/terraria.service"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl unzip

if ! id terraria >/dev/null 2>&1; then
  useradd --system --home-dir "${DATA_DIR}" --create-home --shell /usr/sbin/nologin terraria
fi

install -d -o root -g root -m 0755 "${INSTALL_DIR}"
install -d -o terraria -g terraria -m 0755 "${DATA_DIR}/worlds"
install -d -o terraria -g terraria -m 0755 "${DATA_DIR}/backups"
install -d -o root -g terraria -m 0750 "${CONFIG_DIR}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

curl -fSL "${TERRARIA_URL}" -o "${tmp_dir}/terraria-server.zip"
unzip -q "${tmp_dir}/terraria-server.zip" -d "${tmp_dir}/terraria-server"

rm -rf "${INSTALL_DIR:?}/"*
cp -R "${tmp_dir}/terraria-server/${TERRARIA_VERSION}/Linux/." "${INSTALL_DIR}/"
chmod +x "${INSTALL_DIR}/TerrariaServer" "${INSTALL_DIR}/TerrariaServer.bin.x86_64"
chown -R root:root "${INSTALL_DIR}"

if [ ! -s "${CONFIG_DIR}/server-password.txt" ]; then
  set +o pipefail
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 > "${CONFIG_DIR}/server-password.txt"
  set -o pipefail
  chmod 0640 "${CONFIG_DIR}/server-password.txt"
  chown root:terraria "${CONFIG_DIR}/server-password.txt"
fi

server_password="$(cat "${CONFIG_DIR}/server-password.txt")"

cat > "${CONFIG_DIR}/serverconfig.txt" <<EOF
world=${DATA_DIR}/worlds/world.wld
autocreate=2
worldname=Terraria
difficulty=0

maxplayers=8
port=7777
password=${server_password}
motd=Willkommen auf dem Terraria-Server.

worldrollbackstokeep=3
banlist=${CONFIG_DIR}/banlist.txt
secure=1
language=de-DE
priority=1
EOF

chmod 0640 "${CONFIG_DIR}/serverconfig.txt"
chown root:terraria "${CONFIG_DIR}/serverconfig.txt"
touch "${CONFIG_DIR}/banlist.txt"
chmod 0660 "${CONFIG_DIR}/banlist.txt"
chown root:terraria "${CONFIG_DIR}/banlist.txt"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Terraria Dedicated Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=terraria
Group=terraria
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/TerrariaServer -config ${CONFIG_DIR}/serverconfig.txt
Restart=on-failure
RestartSec=10
StandardInput=tty
TTYPath=/dev/tty12
TTYReset=yes
TTYVHangup=yes
KillSignal=SIGINT
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable terraria.service
systemctl restart terraria.service

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 7777/tcp
fi

if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=7777/tcp
  firewall-cmd --reload
fi

echo "Terraria server installed."
echo "Service: $(systemctl is-active terraria.service)"
echo "Config: ${CONFIG_DIR}/serverconfig.txt"
echo "Worlds: ${DATA_DIR}/worlds"
echo "Password file: ${CONFIG_DIR}/server-password.txt"
