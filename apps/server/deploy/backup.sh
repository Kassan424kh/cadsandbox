#!/usr/bin/env sh
# Encrypted, deduplicated off-site backups with restic (AES-256, client-side encryption).
# Run daily from cron/systemd on the Docker host, e.g.:
#   15 3 * * *  /opt/cadsandbox/apps/server/deploy/backup.sh >> /var/log/cadsandbox-backup.log 2>&1
#
# Required environment (store in /etc/cadsandbox/backup.env, chmod 600):
#   RESTIC_REPOSITORY=s3:https://fsn1.your-objectstorage.com/cadsandbox-backups   # EU region, separate account
#   RESTIC_PASSWORD_FILE=/etc/cadsandbox/restic-password                          # offline copy in the vault!
#   AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…
#   COMPOSE_DIR=/opt/cadsandbox
set -eu
: "${COMPOSE_DIR:?}" "${RESTIC_REPOSITORY:?}"
cd "$COMPOSE_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 1. Consistent logical database dump (custom format, compressed).
docker compose exec -T db pg_dump -U cadsandbox -d cadsandbox -Fc > "$WORK/cadsandbox-$STAMP.dump"

# 2. Blob store + dump into restic (blobs stay encrypted if STORAGE_ENCRYPTION_KEY is set).
APPDATA=$(docker volume inspect -f '{{ .Mountpoint }}' cadsandbox_appdata)
restic backup --tag cadsandbox --host cadsandbox "$WORK" "$APPDATA/blobs"

# 3. Retention: 7 daily, 4 weekly, 6 monthly — matches the retention schedule in docs/gdpr.
restic forget --tag cadsandbox --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check --read-data-subset=1%
