#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

# Remove only the ILIAS resources created by setup-ilias-remote.sh.
a2dissite ilias.conf ilias-ssl.conf >/dev/null 2>&1 || true
rm -f /etc/apache2/sites-available/ilias.conf \
  /etc/apache2/sites-available/ilias-ssl.conf \
  /etc/mysql/mariadb.conf.d/60-ilias.cnf
rm -f /etc/php/*/apache2/conf.d/99-ilias.ini \
  /etc/php/*/cli/conf.d/99-ilias.ini

mysql <<'SQL'
DROP DATABASE IF EXISTS ilias;
DROP USER IF EXISTS 'ilias'@'localhost';
FLUSH PRIVILEGES;
SQL

rm -rf /var/www/ilias /var/www/files/ilias /etc/ilias
rm -f /var/www/config/ilias.json /var/www/logs/ilias.log
rm -f /var/log/apache2/ilias_access.log* \
  /var/log/apache2/ilias_error.log* \
  /var/log/apache2/ilias_ssl_access.log* \
  /var/log/apache2/ilias_ssl_error.log*
rm -f /etc/cron.d/ilias /etc/cron.daily/ilias

apache2ctl configtest
systemctl reload apache2
systemctl restart mariadb

test ! -e /var/www/ilias
test ! -e /var/www/files/ilias
test ! -e /etc/ilias
test "$(mysql -NBe "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='ilias'")" = 0
test "$(mysql -NBe "SELECT COUNT(*) FROM mysql.user WHERE User='ilias' AND Host='localhost'")" = 0

echo "ILIAS removed; shared Apache, PHP and MariaDB packages remain installed."
