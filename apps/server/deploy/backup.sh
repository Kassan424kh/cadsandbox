#!/usr/bin/env bash
# =============================================================================
#  CadSandbox backups — entrypoint of the "backup" service in docker-compose.dokploy.yml
#  (image: apps/server/deploy/backup.Dockerfile). Runbook: apps/server/deploy/BACKUP-RESTORE.md
#
#  One run (`backup.sh run`, scheduled by `backup.sh daemon`):
#    1. pg_dump --format=custom of DATABASE_URL, streamed straight into the encrypted restic
#       repository (RESTIC_REPOSITORY, at a second EU S3 provider). Nothing touches a local disk.
#       A small manifest (table row counts, blob totals) is stored as a second snapshot of the same
#       run so a restore can be verified against it.
#    2. The blob bucket (S3_BUCKET/S3_PREFIX, content-addressed, immutable objects) is mirrored with
#       rclone into an rclone-crypt prefix of the off-site bucket (client-side encrypted names and
#       contents). Objects the app's GC deleted are moved to deleted/<date>/ and purged after
#       BACKUP_BLOB_DELETED_KEEP_DAYS (default 190 ≈ the 6-monthly restic horizon).
#    3. restic forget --prune: 7 daily / 4 weekly / 6 monthly. `backup.sh check` (weekly cron) runs
#       `restic check` with a read-data sample.
#    4. Success/failure heartbeat to BACKUP_HEARTBEAT_URL (Uptime Kuma push or healthchecks-style).
#       On failure: "BACKUP FAILED" log line, exit 1, container healthcheck turns unhealthy.
#
#  Commands: daemon (default) | run | check | snapshots | env-check | healthcheck
#            restore … (→ restore.sh) | restic … | rclone … (escape hatches with the configured remotes)
#  Configuration is environment only; `backup.sh env-check` lists what is missing.
# =============================================================================
set -Eeuo pipefail

STATUS_FILE="${BACKUP_STATUS_FILE:-/tmp/backup-status}"
RESTIC_HOST=cadsandbox
STEP=startup
RUN_ID=''

log() { printf '[backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
blobs_enabled() { [[ ${BACKUP_BLOBS:-true} == true ]]; }

# --- status / monitoring ------------------------------------------------------------------------

record_status() { # ok|fail [detail]
  { printf '%s %s %s\n' "$1" "$(date -u +%s)" "${2:-}" > "$STATUS_FILE.tmp" && mv "$STATUS_FILE.tmp" "$STATUS_FILE"; } || true
}

# heartbeat start|ok|fail <message>
#   Uptime Kuma push monitor (…/api/push/<token>?…): status=up|down + msg; nothing on "start".
#   healthchecks.io-style URL: ping the URL itself on ok, <url>/start and <url>/fail otherwise.
heartbeat() {
  local kind=$1 msg=${2:-} url=${BACKUP_HEARTBEAT_URL:-}
  [[ -n $url ]] || return 0
  local -a curl=(curl -fsS -m 20 --retry 3 --retry-delay 5 -o /dev/null)
  if [[ $url == *"/api/push/"* ]]; then
    [[ $kind == start ]] && return 0
    local status=down
    [[ $kind == ok ]] && status=up
    "${curl[@]}" -G "${url%%\?*}" --data-urlencode "status=$status" --data-urlencode "msg=$msg" --data-urlencode 'ping=' \
      || log "WARN: heartbeat ($kind) could not be delivered"
  else
    case $kind in start) url="${url%/}/start" ;; fail) url="${url%/}/fail" ;; esac
    "${curl[@]}" --data-raw "$msg" "$url" || log "WARN: heartbeat ($kind) could not be delivered"
  fi
}

on_error() {
  local rc=$? line=$1
  log "BACKUP FAILED at step '$STEP' (exit $rc, line $line)${RUN_ID:+ — run $RUN_ID}" >&2
  record_status fail "$STEP"
  heartbeat fail "cadsandbox backup failed at step $STEP (exit $rc)${RUN_ID:+, run $RUN_ID}"
  exit "$rc"
}

# --- configuration ------------------------------------------------------------------------------

# Validates the environment, derives defaults and exports what restic/rclone read. Prints every
# missing variable at once; returns 1 if the configuration is incomplete.
env_check() {
  local missing=() v
  for v in DATABASE_URL RESTIC_PASSWORD; do [[ -n ${!v:-} ]] || missing+=("$v"); done
  if [[ -z ${RESTIC_REPOSITORY:-} ]]; then
    if [[ -n ${BACKUP_S3_ENDPOINT:-} && -n ${BACKUP_S3_BUCKET:-} ]]; then
      export RESTIC_REPOSITORY="s3:${BACKUP_S3_ENDPOINT%/}/${BACKUP_S3_BUCKET}/restic"
    else
      missing+=("RESTIC_REPOSITORY (or BACKUP_S3_ENDPOINT + BACKUP_S3_BUCKET to derive it)")
    fi
  fi
  # restic's S3 backend reads AWS_*; BACKUP_S3_* are the operator-facing names.
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${BACKUP_S3_ACCESS_KEY_ID:-}}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${BACKUP_S3_SECRET_ACCESS_KEY:-}}"
  if [[ ${RESTIC_REPOSITORY:-} == s3:* && ( -z $AWS_ACCESS_KEY_ID || -z $AWS_SECRET_ACCESS_KEY ) ]]; then
    missing+=("BACKUP_S3_ACCESS_KEY_ID + BACKUP_S3_SECRET_ACCESS_KEY")
  fi
  if blobs_enabled; then
    local blob_missing=()
    for v in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET; do
      [[ -n ${!v:-} ]] || blob_missing+=("$v")
    done
    ((${#blob_missing[@]} == 0)) || missing+=("${blob_missing[*]} (for the blob mirror; BACKUP_BLOBS=false skips it)")
  fi
  if [[ -n ${BACKUP_LOCAL_BLOBS_DIR:-} && ! -d ${BACKUP_LOCAL_BLOBS_DIR} ]]; then
    missing+=("BACKUP_LOCAL_BLOBS_DIR points to a directory that is not mounted")
  fi
  if ((${#missing[@]})); then
    log "configuration incomplete — missing: ${missing[*]}" >&2
    return 1
  fi
  export RCLONE_CONFIG="${RCLONE_CONFIG:-/tmp/rclone.conf}"
  : > "$RCLONE_CONFIG" 2>/dev/null || true # remotes come from the environment; an empty file silences rclone's notice
  return 0
}

# rclone remotes, defined through the environment (no config file, no secrets on disk):
#   src:    the app's bucket           blobs: crypt layer on top of  dst:<BACKUP_S3_BUCKET>/<BACKUP_BLOB_PATH>
#   dst:    the off-site bucket        (filenames + directory names + contents encrypted)
rclone_setup() {
  export RCLONE_S3_NO_CHECK_BUCKET=true # buckets are created by the operator; never try to create them
  export RCLONE_CONFIG_SRC_TYPE=s3 \
    RCLONE_CONFIG_SRC_PROVIDER="${S3_RCLONE_PROVIDER:-Other}" \
    RCLONE_CONFIG_SRC_ENDPOINT="$S3_ENDPOINT" \
    RCLONE_CONFIG_SRC_REGION="${S3_REGION:-us-east-1}" \
    RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
    RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_SRC_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"
  export RCLONE_CONFIG_DST_TYPE=s3 \
    RCLONE_CONFIG_DST_PROVIDER="${BACKUP_S3_PROVIDER:-Other}" \
    RCLONE_CONFIG_DST_ENDPOINT="$BACKUP_S3_ENDPOINT" \
    RCLONE_CONFIG_DST_REGION="${BACKUP_S3_REGION:-eu-central-1}" \
    RCLONE_CONFIG_DST_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
    RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
    RCLONE_CONFIG_DST_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-true}"
  export RCLONE_CONFIG_BLOBS_TYPE=crypt \
    RCLONE_CONFIG_BLOBS_REMOTE="dst:${BACKUP_S3_BUCKET}/${BACKUP_BLOB_PATH:-blobs}" \
    RCLONE_CONFIG_BLOBS_FILENAME_ENCRYPTION=standard \
    RCLONE_CONFIG_BLOBS_DIRECTORY_NAME_ENCRYPTION=true
  RCLONE_CONFIG_BLOBS_PASSWORD=$(printf '%s' "${BACKUP_BLOB_PASSWORD:-$RESTIC_PASSWORD}" | rclone obscure -)
  export RCLONE_CONFIG_BLOBS_PASSWORD
}

# rclone path of the app's blob prefix, e.g. src:cadsandbox/blobs
src_path() {
  local p=${S3_PREFIX-blobs/}
  p=${p#/}
  p=${p%/}
  if [[ -n $p ]]; then printf 'src:%s/%s' "$S3_BUCKET" "$p"; else printf 'src:%s' "$S3_BUCKET"; fi
}

# shared rclone flags: content-addressed keys never change, so size is a sufficient comparison
# (no per-object HEAD requests); --fast-list lists the bucket flat instead of 65 536 directories.
RCLONE_SYNC_FLAGS=(--size-only --fast-list --transfers "${BACKUP_RCLONE_TRANSFERS:-8}" --checkers "${BACKUP_RCLONE_CHECKERS:-16}"
  --stats 30m --stats-one-line --stats-log-level NOTICE)

# --- steps --------------------------------------------------------------------------------------

ensure_repo() {
  STEP=restic-init
  if restic cat config >/dev/null 2>&1; then return 0; fi
  log "restic: no repository at $RESTIC_REPOSITORY — initializing a new one"
  restic init
}

backup_db() {
  STEP=db-dump
  log "db: pg_dump --format=custom → restic ($RESTIC_REPOSITORY)"
  # --stdin-from-command: restic creates NO snapshot if pg_dump exits non-zero (no truncated dumps).
  restic backup --json --retry-lock 30m --host "$RESTIC_HOST" --tag db --tag "run-$RUN_ID" \
    --stdin-from-command --stdin-filename cadsandbox.dump \
    -- pg_dump --format=custom --no-password --dbname "$DATABASE_URL" \
    | jq -r 'select(.message_type == "summary")
             | "[backup] db: snapshot \(.snapshot_id[0:8]) saved (\(.total_bytes_processed) bytes, \(.data_added) new bytes in repo)"'
}

# Second snapshot of the same run: what a restore drill compares against (restore.sh verify-db).
backup_manifest() {
  STEP=manifest
  local manifest
  manifest=$(build_manifest)
  printf '%s\n' "$manifest" | restic backup --quiet --retry-lock 30m --host "$RESTIC_HOST" --tag manifest --tag "run-$RUN_ID" \
    --stdin --stdin-filename manifest.txt
  log "manifest stored ($(printf '%s\n' "$manifest" | grep -c '^  ' || true) tables)"
}

# Exact row counts of every table (all schemas except the catalogs) — the reference for restore drills.
COUNT_SQL="SELECT format('%I.%I', table_schema, table_name),
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE'
ORDER BY 1"

pq() { psql -X -At -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -c "$1"; }

build_manifest() {
  printf 'cadsandbox backup manifest\nrun: %s\ntime: %s\n' "$RUN_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'postgres: %s\n' "$(pq 'SELECT version()')"
  printf 'database_size_bytes: %s\n' "$(pq 'SELECT pg_database_size(current_database())')"
  if blobs_enabled; then # informational; S3 reports an empty prefix as "not found", hence the fallback
    printf 'blobs_source: %s\nblobs_source_size: %s\n' "$(src_path)" \
      "$(rclone size --json --fast-list "$(src_path)" 2>/dev/null || echo '{"count":0,"bytes":0}')"
    printf 'blobs_mirror_size: %s\n' "$(rclone size --json --fast-list blobs:current 2>/dev/null || echo '{"count":0,"bytes":0}')"
  fi
  printf 'table_rows:\n'
  pq "$COUNT_SQL" | sed 's/^/  /; s/|/ /'
}

backup_blobs() {
  local src today
  src=$(src_path)
  today=$(date -u +%F)
  STEP=blobs-sync
  # The bucket itself must be listable (credentials, endpoint); a missing prefix only means no uploads
  # yet — S3 reports an empty prefix as "directory not found", which would fail the sync.
  rclone lsf --max-depth 1 "src:$S3_BUCKET" >/dev/null
  if ! rclone lsf --max-depth 1 "$src" >/dev/null 2>&1; then
    log "blobs: no objects under $src yet — nothing to mirror"
    return 0
  fi
  log "blobs: rclone sync $src → blobs:current (encrypted); removed objects → blobs:deleted/$today"
  # exit 0 means every listed source object exists in the mirror with the same size (rclone exits
  # non-zero on any failed transfer); a separate `rclone check` would only race with new uploads.
  rclone sync "$src" blobs:current --backup-dir "blobs:deleted/$today" "${RCLONE_SYNC_FLAGS[@]}"
  STEP=blobs-prune
  local keep=${BACKUP_BLOB_DELETED_KEEP_DAYS:-190} cutoff d
  cutoff=$(date -u -d "-${keep} days" +%F)
  while IFS= read -r d; do
    d=${d%/}
    [[ $d =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
    if [[ $d < $cutoff ]]; then
      log "blobs: purging deleted/$d (older than $keep days)"
      rclone purge "blobs:deleted/$d"
    fi
  done < <(rclone lsf --dirs-only blobs:deleted 2>/dev/null || true)
}

backup_local_blobs() { # optional: STORAGE_DRIVER=local layouts mount their blob directory read-only
  STEP=local-blobs
  log "blobs: restic backup of $BACKUP_LOCAL_BLOBS_DIR"
  restic backup --quiet --retry-lock 30m --host "$RESTIC_HOST" --tag blobs --tag "run-$RUN_ID" "$BACKUP_LOCAL_BLOBS_DIR"
}

forget_prune() {
  STEP=restic-forget
  log "restic: forget --prune (keep ${BACKUP_KEEP_DAILY:-7} daily / ${BACKUP_KEEP_WEEKLY:-4} weekly / ${BACKUP_KEEP_MONTHLY:-6} monthly)"
  restic forget --quiet --retry-lock 30m --host "$RESTIC_HOST" \
    --keep-daily "${BACKUP_KEEP_DAILY:-7}" --keep-weekly "${BACKUP_KEEP_WEEKLY:-4}" --keep-monthly "${BACKUP_KEEP_MONTHLY:-6}" --prune
}

# --- commands -----------------------------------------------------------------------------------

cmd_run() {
  trap 'on_error $LINENO' ERR
  RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
  local t0=$SECONDS
  if ! env_check; then
    record_status fail config
    heartbeat fail "cadsandbox backup: configuration incomplete"
    log "BACKUP FAILED: configuration incomplete (see above)" >&2
    return 1
  fi
  log "run $RUN_ID starting"
  heartbeat start "run $RUN_ID"
  blobs_enabled && rclone_setup
  ensure_repo
  backup_db
  if blobs_enabled; then backup_blobs; fi
  if [[ -n ${BACKUP_LOCAL_BLOBS_DIR:-} ]]; then backup_local_blobs; fi
  backup_manifest
  forget_prune
  STEP=done
  record_status ok "$RUN_ID"
  log "BACKUP OK — run $RUN_ID finished in $((SECONDS - t0))s"
  heartbeat ok "cadsandbox backup $RUN_ID ok in $((SECONDS - t0))s"
}

cmd_check() {
  trap 'on_error $LINENO' ERR
  env_check || die "configuration incomplete"
  STEP=restic-check
  log "restic check (--read-data-subset=${BACKUP_CHECK_READ_SUBSET:-10%})"
  restic check --retry-lock 30m --read-data-subset="${BACKUP_CHECK_READ_SUBSET:-10%}"
  log "restic check OK"
}

cmd_daemon() {
  log "cadsandbox backup runner — $(restic version) | $(rclone version | head -n1) | $(pg_dump --version)"
  if ! env_check; then
    record_status fail config
    log "BACKUP FAILED: configuration incomplete — backups are NOT running. Fix the environment (Dokploy → Environment) and redeploy; retrying in 1 h." >&2
    sleep 3600
    exit 1
  fi
  local schedule=${BACKUP_SCHEDULE:-15 3 * * *} check=${BACKUP_CHECK_SCHEDULE:-45 4 * * 0} crontab=/tmp/crontab
  {
    printf '%s backup.sh run\n' "$schedule"
    [[ $check == never ]] || printf '%s backup.sh check\n' "$check"
  } > "$crontab"
  supercronic -test "$crontab" >/dev/null 2>&1 \
    || die "invalid BACKUP_SCHEDULE ('$schedule') or BACKUP_CHECK_SCHEDULE ('$check') — five cron fields, e.g. '15 3 * * *'"
  log "repository $RESTIC_REPOSITORY; schedule (TZ=${TZ:-UTC}): backup '$schedule', check '$check'; blobs: $(blobs_enabled && src_path || echo disabled)"
  if [[ ${BACKUP_RUN_ON_START:-false} == true ]]; then backup.sh run || true; fi
  exec supercronic -passthrough-logs "$crontab"
}

# Container healthcheck: unhealthy after a failed run, or when the last success is older than
# BACKUP_MAX_AGE_HOURS (26). Healthy before the first run of this container (start_period).
cmd_healthcheck() {
  local state ts rest max=${BACKUP_MAX_AGE_HOURS:-26}
  [[ -f $STATUS_FILE ]] || exit 0
  read -r state ts rest < "$STATUS_FILE"
  : "$rest"
  [[ $state == ok ]] || { echo "last backup run failed"; exit 1; }
  (( $(date -u +%s) - ts < max * 3600 )) || { echo "last successful backup is older than ${max}h"; exit 1; }
  exit 0
}

usage() {
  cat <<'EOF'
usage: backup.sh [daemon|run|check|snapshots|env-check|healthcheck|restore …|restic …|rclone …]
  daemon      run BACKUP_SCHEDULE / BACKUP_CHECK_SCHEDULE with supercronic (container default)
  run         one backup now: db dump + manifest → restic, blob mirror, forget --prune (exit 1 on failure)
  check       restic check with a read-data sample
  snapshots   list restic snapshots (db dumps, manifests)
  env-check   validate the configuration without touching the network
  restore …   see restore.sh (db, blobs, verify-db, verify-blobs, verify-blob)
  restic …    run restic against the configured repository;  rclone …  run rclone with remotes src:, dst:, blobs:
EOF
}

main() {
  case ${1:-daemon} in
    daemon) cmd_daemon ;;
    run) cmd_run ;;
    check) cmd_check ;;
    snapshots) shift; env_check || exit 1; exec restic snapshots --host "$RESTIC_HOST" "$@" ;;
    env-check) env_check && log "configuration OK — repository $RESTIC_REPOSITORY, blobs $(blobs_enabled && src_path || echo disabled)" ;;
    healthcheck) cmd_healthcheck ;;
    restore) shift; exec restore.sh "$@" ;;
    restic) shift; env_check || exit 1; exec restic "$@" ;;
    rclone) shift; env_check || exit 1; rclone_setup; exec rclone "$@" ;;
    -h|--help|help) usage ;;
    *) usage >&2; exit 2 ;;
  esac
}

# restore.sh sources this file for the shared functions; only run main when executed directly.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
