#!/usr/bin/env bash
set -euo pipefail

ILIAS_VERSION="11.1"
ILIAS_URL="https://github.com/ILIAS-eLearning/ILIAS/releases/download/v${ILIAS_VERSION}/ILIAS-${ILIAS_VERSION}.tar.gz"
ILIAS_MD5="91d156ad06e04463a0a812f8affe17e1"
SERVER_NAME="v2202606364772466585.supersrv.de"
CLIENT_ID="ilias"

INSTALL_DIR="/var/www/ilias"
FILES_DIR="/var/www/files/ilias"
LOG_DIR="/var/www/logs"
CONFIG_DIR="/var/www/config"
SECRET_DIR="/etc/ilias"
DB_NAME="ilias"
DB_USER="ilias"
DB_PASS_FILE="${SECRET_DIR}/db-password.txt"
BASIC_AUTH_USER="ilias-admin"
BASIC_AUTH_PASS_FILE="${SECRET_DIR}/basic-auth-password.txt"
BASIC_AUTH_FILE="${SECRET_DIR}/apache.htpasswd"

export DEBIAN_FRONTEND=noninteractive

random_alnum() {
  set +o pipefail
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}"
  set -o pipefail
}

install_secret_file() {
  local path="$1"
  local length="${2:-32}"

  install -d -o root -g root -m 0750 "${SECRET_DIR}"
  if [ ! -s "${path}" ]; then
    random_alnum "${length}" > "${path}"
    echo >> "${path}"
  fi
  chmod 0600 "${path}"
  chown root:root "${path}"
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root." >&2
    exit 1
  fi
}

configure_swap() {
  if ! swapon --show=NAME --noheadings | grep -q .; then
    fallocate -l 2G /swapfile
    chmod 0600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q '^/swapfile ' /etc/fstab; then
      printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
    fi
  fi
}

install_packages() {
  apt-get update
  apt-get install -y --no-install-recommends \
    apache2 apache2-utils ca-certificates certbot curl ffmpeg ghostscript \
    imagemagick libapache2-mod-php mariadb-server php php-cli php-curl \
    php-gd php-imagick php-ldap php-mbstring php-mysql php-soap php-xml \
    php-xsl php-zip python3-certbot-apache tar unzip zip
}

configure_php() {
  local conf_dir
  for conf_dir in /etc/php/*/apache2/conf.d /etc/php/*/cli/conf.d; do
    [ -d "${conf_dir}" ] || continue
    cat > "${conf_dir}/99-ilias.ini" <<'EOF'
max_execution_time = 600
memory_limit = 512M
post_max_size = 256M
upload_max_filesize = 256M
display_errors = Off
session.gc_probability = 1
session.gc_divisor = 100
session.gc_maxlifetime = 14400
session.cookie_httponly = On
session.save_handler = files
max_input_vars = 10000
allow_url_fopen = 1
EOF
  done
}

configure_mariadb() {
  cat > /etc/mysql/mariadb.conf.d/60-ilias.cnf <<'EOF'
[mysqld]
character-set-server = utf8mb3
collation-server = utf8mb3_general_ci
join_buffer_size = 256K
table_open_cache = 800
innodb_buffer_pool_size = 1G
sql_mode = IGNORE_SPACE,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
EOF

  systemctl enable mariadb.service
  systemctl restart mariadb.service

  local db_password
  db_password="$(tr -d '\r\n' < "${DB_PASS_FILE}")"
  mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8 COLLATE utf8_general_ci;"
  mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${db_password}';"
  mysql -e "ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${db_password}';"
  mysql -e "GRANT LOCK TABLES ON *.* TO '${DB_USER}'@'localhost';"
  mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
  mysql -e "FLUSH PRIVILEGES;"
}

prepare_directories() {
  install -d -o www-data -g www-data -m 0755 "${INSTALL_DIR}"
  install -d -o www-data -g www-data -m 0755 "${FILES_DIR}"
  install -d -o www-data -g www-data -m 0755 "${LOG_DIR}"
  install -d -o www-data -g www-data -m 0750 "${CONFIG_DIR}"
  install -d -o www-data -g www-data -m 0755 /var/www/.npm
}

install_ilias_code() {
  if [ -f "${INSTALL_DIR}/cli/setup.php" ]; then
    return
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' RETURN

  curl -fL "${ILIAS_URL}" -o "${tmp_dir}/ILIAS-${ILIAS_VERSION}.tar.gz"
  printf '%s  %s\n' "${ILIAS_MD5}" "${tmp_dir}/ILIAS-${ILIAS_VERSION}.tar.gz" | md5sum -c -
  tar -xzf "${tmp_dir}/ILIAS-${ILIAS_VERSION}.tar.gz" \
    -C "${INSTALL_DIR}" \
    --strip-components=1 \
    "ILIAS-${ILIAS_VERSION}/"
  chown -R www-data:www-data "${INSTALL_DIR}"
}

configure_basic_auth() {
  local basic_password
  basic_password="$(tr -d '\r\n' < "${BASIC_AUTH_PASS_FILE}")"
  htpasswd -bc "${BASIC_AUTH_FILE}" "${BASIC_AUTH_USER}" "${basic_password}" >/dev/null
  chown root:www-data "${SECRET_DIR}"
  chmod 0750 "${SECRET_DIR}"
  chmod 0640 "${BASIC_AUTH_FILE}"
  chown root:www-data "${BASIC_AUTH_FILE}"
}

configure_apache() {
  cat > /etc/apache2/sites-available/ilias.conf <<EOF
<VirtualHost *:80>
    ServerName ${SERVER_NAME}
    ServerAdmin webmaster@localhost
    DocumentRoot ${INSTALL_DIR}/public

    <Directory ${INSTALL_DIR}/public>
        Options +FollowSymLinks -Indexes
        AllowOverride All
        Require all granted
    </Directory>

    <LocationMatch "^/(?!\\.well-known/acme-challenge/)">
        AuthType Basic
        AuthName "ILIAS"
        AuthUserFile ${BASIC_AUTH_FILE}
        Require valid-user
    </LocationMatch>

    LogLevel warn
    ErrorLog \${APACHE_LOG_DIR}/ilias_error.log
    CustomLog \${APACHE_LOG_DIR}/ilias_access.log combined
</VirtualHost>
EOF

  a2enmod rewrite headers ssl >/dev/null
  a2dissite 000-default.conf >/dev/null 2>&1 || true
  a2ensite ilias.conf >/dev/null
  systemctl enable apache2.service
  systemctl restart apache2.service
}

try_letsencrypt() {
  local scheme="http"
  local certbot_log="/tmp/ilias-certbot.log"

  if [ "${ENABLE_LETSENCRYPT:-0}" != "1" ]; then
    printf '%s\n' "${scheme}"
    return
  fi

  if certbot certonly --webroot \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      -w "${INSTALL_DIR}/public" \
      -d "${SERVER_NAME}" >"${certbot_log}" 2>&1; then
    cat > /etc/apache2/sites-available/ilias-ssl.conf <<EOF
<VirtualHost *:443>
    ServerName ${SERVER_NAME}
    ServerAdmin webmaster@localhost
    DocumentRoot ${INSTALL_DIR}/public

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/${SERVER_NAME}/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/${SERVER_NAME}/privkey.pem

    <Directory ${INSTALL_DIR}/public>
        Options +FollowSymLinks -Indexes
        AllowOverride All
        Require all granted
    </Directory>

    <LocationMatch "^/(?!\\.well-known/acme-challenge/)">
        AuthType Basic
        AuthName "ILIAS"
        AuthUserFile ${BASIC_AUTH_FILE}
        Require valid-user
    </LocationMatch>

    LogLevel warn
    ErrorLog \${APACHE_LOG_DIR}/ilias_ssl_error.log
    CustomLog \${APACHE_LOG_DIR}/ilias_ssl_access.log combined
</VirtualHost>
EOF

    cat > /etc/apache2/sites-available/ilias.conf <<EOF
<VirtualHost *:80>
    ServerName ${SERVER_NAME}
    ServerAdmin webmaster@localhost
    DocumentRoot ${INSTALL_DIR}/public

    <Directory ${INSTALL_DIR}/public>
        Options +FollowSymLinks -Indexes
        AllowOverride All
        Require all granted
    </Directory>

    Alias /.well-known/acme-challenge/ ${INSTALL_DIR}/public/.well-known/acme-challenge/

    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/
    RewriteRule ^ https://${SERVER_NAME}%{REQUEST_URI} [R=301,L]

    LogLevel warn
    ErrorLog \${APACHE_LOG_DIR}/ilias_error.log
    CustomLog \${APACHE_LOG_DIR}/ilias_access.log combined
</VirtualHost>
EOF

    a2ensite ilias-ssl.conf >/dev/null
    systemctl reload apache2.service
    scheme="https"
  else
    cat "${certbot_log}" >&2 || true
    echo "Let's Encrypt setup failed; continuing with HTTP." >&2
  fi

  printf '%s\n' "${scheme}"
}

write_ilias_config() {
  local scheme="$1"
  local db_password
  local https_enabled="false"

  db_password="$(tr -d '\r\n' < "${DB_PASS_FILE}")"
  if [ "${scheme}" = "https" ]; then
    https_enabled="true"
  fi

  cat > "${CONFIG_DIR}/ilias.json" <<EOF
{
  "common": {
    "client_id": "${CLIENT_ID}",
    "server_timezone": "Europe/Berlin"
  },
  "database": {
    "type": "innodb",
    "host": "localhost",
    "database": "${DB_NAME}",
    "user": "${DB_USER}",
    "password": "${db_password}",
    "create_database": false
  },
  "filesystem": {
    "data_dir": "${FILES_DIR}"
  },
  "logging": {
    "enable": true,
    "path_to_logfile": "${LOG_DIR}/ilias.log",
    "errorlog_dir": "${LOG_DIR}"
  },
  "http": {
    "path": "${scheme}://${SERVER_NAME}",
    "allowed_hosts": [
      "${SERVER_NAME}"
    ]
  },
  "privacysecurity": {
    "https_enabled": ${https_enabled}
  },
  "systemfolder": {
    "client": {
      "name": "ILIAS",
      "description": "ILIAS learning platform",
      "institution": "Server"
    },
    "contact": {
      "firstname": "Admin",
      "lastname": "Admin",
      "email": "admin@${SERVER_NAME}"
    }
  },
  "utilities": {
    "path_to_convert": "/usr/bin/convert",
    "path_to_zip": "/usr/bin/zip",
    "path_to_unzip": "/usr/bin/unzip"
  },
  "mediaobject": {
    "path_to_ffmpeg": "/usr/bin/ffmpeg"
  },
  "preview": {
    "path_to_ghostscript": "/usr/bin/gs"
  }
}
EOF

  chown www-data:www-data "${CONFIG_DIR}/ilias.json"
  chmod 0640 "${CONFIG_DIR}/ilias.json"
}

install_or_update_ilias() {
  cd "${INSTALL_DIR}"

  if [ -f "${INSTALL_DIR}/ilias.ini.php" ] || [ -d "${INSTALL_DIR}/data/${CLIENT_ID}" ]; then
    runuser -u www-data -- php cli/setup.php update "${CONFIG_DIR}/ilias.json" --yes
  else
    runuser -u www-data -- php cli/setup.php install "${CONFIG_DIR}/ilias.json" --yes
  fi
}

verify_installation() {
  local scheme="$1"
  local basic_password
  basic_password="$(tr -d '\r\n' < "${BASIC_AUTH_PASS_FILE}")"

  cd "${INSTALL_DIR}"
  runuser -u www-data -- php cli/setup.php status || true
  curl -k -I -u "${BASIC_AUTH_USER}:${basic_password}" "${scheme}://${SERVER_NAME}" || true
}

main() {
  require_root
  install_secret_file "${DB_PASS_FILE}" 32
  install_secret_file "${BASIC_AUTH_PASS_FILE}" 24
  configure_swap
  install_packages
  configure_php
  prepare_directories
  install_ilias_code
  configure_basic_auth
  configure_apache
  configure_mariadb

  local scheme
  scheme="$(try_letsencrypt)"
  write_ilias_config "${scheme}"
  install_or_update_ilias
  verify_installation "${scheme}"

  echo "ILIAS ${ILIAS_VERSION} installed."
  echo "URL: ${scheme}://${SERVER_NAME}"
  echo "Apache basic auth user: ${BASIC_AUTH_USER}"
  echo "Apache basic auth password file: ${BASIC_AUTH_PASS_FILE}"
  echo "ILIAS initial login: root / homer"
}

main "$@"
