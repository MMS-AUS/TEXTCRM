#!/usr/bin/env bash
# Nightly Postgres backup for the production stack. Installed on the VPS at /usr/local/bin/crm-backup
# and run by cron (see /etc/cron.d/crm-backup). Keeps the last 14 days in /srv/crm-backups.
set -euo pipefail

DIR=/srv/crm-backups
KEEP_DAYS=14
CONTAINER=mmscrm-prod-postgres-1
FILE="$DIR/crm-$(date +%Y%m%d-%H%M%S).sql.gz"

mkdir -p "$DIR"
umask 077
docker exec "$CONTAINER" pg_dump -U crm -d crm --no-owner | gzip -9 > "$FILE.partial"
# A truncated dump must never look like a good backup.
gzip -t "$FILE.partial"
mv "$FILE.partial" "$FILE"
find "$DIR" -name 'crm-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
