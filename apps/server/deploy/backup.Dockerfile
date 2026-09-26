# syntax=docker/dockerfile:1.7
# CadSandbox backup runner (service "backup" in docker-compose.dokploy.yml).
#   pg_dump  → restic repository (encrypted, off-site)      backup.sh
#   blob bucket → rclone crypt mirror (encrypted, off-site)  backup.sh
#   scheduling: supercronic (cron syntax, runs as the unprivileged user, logs to stdout)
#   restore + verification: restore.sh — see BACKUP-RESTORE.md
#
# PG_MAJOR must be >= the PostgreSQL server's major version (pg_dump refuses newer servers).
# Alpine 3.22 ships postgresql17-client 17.x, restic 0.18, rclone 1.69, supercronic 0.2.
ARG ALPINE_VERSION=3.22
FROM alpine:${ALPINE_VERSION}
ARG PG_MAJOR=17
RUN apk add --no-cache bash coreutils curl ca-certificates tzdata jq \
      "postgresql${PG_MAJOR}-client" restic rclone supercronic \
 && adduser -D -H -u 10001 backup \
 && mkdir -p /cache && chown backup:backup /cache
COPY --chmod=755 backup.sh restore.sh /usr/local/bin/
# read-only root FS in compose: HOME and rclone's (empty) config live on the /tmp tmpfs, restic's cache on /cache
ENV HOME=/tmp \
    RESTIC_CACHE_DIR=/cache \
    RCLONE_CONFIG=/tmp/rclone.conf \
    TZ=UTC
USER backup
VOLUME ["/cache"]
HEALTHCHECK --interval=5m --timeout=15s --start-period=2m --retries=1 CMD ["backup.sh", "healthcheck"]
ENTRYPOINT ["backup.sh"]
CMD ["daemon"]
