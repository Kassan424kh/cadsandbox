#!/usr/bin/env bash
# =============================================================================
#  CadSandbox restore — companion of backup.sh (same image, same environment).
#  Runbook with the quarterly drill: apps/server/deploy/BACKUP-RESTORE.md
#
#   restore.sh snapshots                                   restic snapshots (db dumps + manifests; newest last)
#   restore.sh db --to <postgres-url> [--snapshot <id>]    pg_restore a dump into an EXISTING, EMPTY database,
#                                                          then verify every table's row count (verify-db)
#   restore.sh verify-db --to <postgres-url> [--snapshot <id>]
#                                                          compare a database with the manifest of that run
#   restore.sh blobs --to <bucket[/prefix]> [--as-of YYYY-MM-DD] [--dry-run]
#                                                          decrypt + copy the off-site blob mirror into a bucket on
#                                                          the app's S3 endpoint; --as-of also brings back objects
#                                                          the GC removed on/after that date (needed for older dumps)
#   restore.sh verify-blobs --to <postgres-url> [--in <bucket[/prefix]>] [--count N]
#                                                          sha256 spot check of N random blobs (default 5) listed in
#                                                          that database; default source: the off-site mirror
#   restore.sh verify-blob <sha256> [--in <bucket[/prefix]>]
#
#  Refuses to write into DATABASE_URL or the live blob prefix. Exit code 0 only if every check passed.
#  Inside the compose project:  docker compose -f docker-compose.dokploy.yml run --rm backup restore <command …>
# =============================================================================
set -Eeuo pipefail
# shellcheck source=backup.sh
source "$(dirname "$(readlink -f "$0")")/backup.sh"

pqt() { psql -X -At -v ON_ERROR_STOP=1 -d "$1" -c "$2" </dev/null; }
redact_url() { sed -E 's#(//[^:/@]+):[^@]*@#\1:***@#' <<<"$1"; }

# --- snapshots ----------------------------------------------------------------------------------

# JSON of one snapshot: an explicit id, or the newest one carrying <tag>.
snapshot_json() { # <id|latest> <tag>
  local id=$1 tag=$2 json
  if [[ $id == latest ]]; then
    json=$(restic snapshots --json --host "$RESTIC_HOST" --tag "$tag" | jq -c '.[-1] // empty')
  else
    json=$(restic snapshots --json "$id" | jq -c '.[0] // empty')
  fi
  [[ -n $json ]] || die "no snapshot found (id: $id, tag: $tag) — see 'restore.sh snapshots'"
  printf '%s' "$json"
}

# --- database -----------------------------------------------------------------------------------

verify_db() { # <postgres-url> <db snapshot json>
  local runtag msnap manifest tbl expected actual bad=0 n=0
  runtag=$(jq -r '.tags[]? | select(startswith("run-"))' <<<"$2" | head -n1)
  [[ -n $runtag ]] || die "snapshot has no run-* tag; cannot find its manifest"
  msnap=$(restic snapshots --json --host "$RESTIC_HOST" --tag "manifest,$runtag" | jq -r '.[-1].id // empty')
  [[ -n $msnap ]] || die "no manifest snapshot for $runtag (was the run interrupted after the dump?)"
  manifest=$(restic dump "$msnap" /manifest.txt)
  log "verifying row counts of $(redact_url "$1") against manifest $runtag"
  while read -r tbl expected; do
    [[ -n $tbl ]] || continue
    n=$((n + 1))
    actual=$(pqt "$1" "SELECT count(*) FROM $tbl" 2>/dev/null || echo MISSING)
    if [[ $actual == "$expected" ]]; then
      printf '  ok        %-44s %12s\n' "$tbl" "$actual"
    else
      printf '  MISMATCH  %-44s %12s   (manifest: %s)\n' "$tbl" "$actual" "$expected"
      bad=$((bad + 1))
    fi
  done < <(printf '%s\n' "$manifest" | sed -n '/^table_rows:/,$p' | tail -n +2 | sed 's/^  //')
  ((n > 0)) || die "manifest $runtag lists no tables"
  ((bad == 0)) || die "$bad of $n tables differ from the manifest"
  log "verify-db OK: $n tables match manifest $runtag"
}

cmd_db() {
  local to='' snapshot=latest
  while (($#)); do
    case $1 in
      --to) to=$2; shift 2 ;;
      --snapshot) snapshot=$2; shift 2 ;;
      *) die "db: unknown argument $1" ;;
    esac
  done
  env_check || exit 1
  [[ -n $to ]] || die "db: --to <postgres-url> of an existing, EMPTY database is required"
  [[ $to != "$DATABASE_URL" ]] || die "db: refusing to restore into DATABASE_URL (the live database)"
  local snap id tables rc=0
  snap=$(snapshot_json "$snapshot" db)
  id=$(jq -r .short_id <<<"$snap")
  tables=$(pqt "$to" "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')")
  ((tables == 0)) || die "db: target already contains $tables tables — restore only into an empty database"
  log "restoring snapshot $id ($(jq -r .time <<<"$snap")) → $(redact_url "$to")"
  restic dump "$id" /cadsandbox.dump | pg_restore --no-owner --no-privileges --dbname "$to" || rc=$?
  ((rc == 0)) || log "WARN: pg_restore exited $rc — read its messages above; the row-count check below decides"
  verify_db "$to" "$snap"
  log "db restore OK: snapshot $id → $(redact_url "$to")"
}

cmd_verify_db() {
  local to='' snapshot=latest
  while (($#)); do
    case $1 in
      --to) to=$2; shift 2 ;;
      --snapshot) snapshot=$2; shift 2 ;;
      *) die "verify-db: unknown argument $1" ;;
    esac
  done
  env_check || exit 1
  [[ -n $to ]] || die "verify-db: --to <postgres-url> is required"
  verify_db "$to" "$(snapshot_json "$snapshot" db)"
}

# --- blobs --------------------------------------------------------------------------------------

RCLONE_COPY_FLAGS=(--size-only --fast-list --transfers 8 --checkers 16 --stats 30m --stats-one-line --stats-log-level NOTICE)

cmd_blobs() {
  local to='' asof='' dry=false d dest
  while (($#)); do
    case $1 in
      --to) to=$2; shift 2 ;;
      --as-of) asof=$2; shift 2 ;;
      --dry-run) dry=true; shift ;;
      *) die "blobs: unknown argument $1" ;;
    esac
  done
  env_check || exit 1
  blobs_enabled || die "blobs: BACKUP_BLOBS=false — no blob mirror is configured"
  rclone_setup
  [[ -n $to ]] || die "blobs: --to <bucket[/prefix]> on the app's S3 endpoint is required (e.g. cadsandbox-restore/blobs)"
  dest="src:${to#/}"
  dest=${dest%/}
  [[ $dest != "$(src_path)" ]] || die "blobs: refusing to write into the live blob prefix $(src_path) — use a fresh bucket/prefix"
  [[ -z $asof || $asof =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "blobs: --as-of expects YYYY-MM-DD"
  local -a flags=("${RCLONE_COPY_FLAGS[@]}")
  [[ $dry == false ]] || flags+=(--dry-run)
  log "copying blobs:current (decrypted) → $dest"
  rclone copy blobs:current "$dest" "${flags[@]}"
  if [[ -n $asof ]]; then
    while IFS= read -r d; do
      d=${d%/}
      [[ $d =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
      if [[ ! $d < $asof ]]; then
        log "copying objects the GC removed on $d (may still be referenced by a dump from $asof) → $dest"
        rclone copy "blobs:deleted/$d" "$dest" "${flags[@]}"
      fi
    done < <(rclone lsf --dirs-only blobs:deleted 2>/dev/null || true)
  fi
  log "blob restore done — $dest: $(rclone size --json --fast-list "$dest")"
}

# One blob: plaintext objects are re-hashed and compared with their content address. Objects the app
# encrypted (.enc, STORAGE_ENCRYPTION_KEY) cannot be hashed without the key: header and — when the
# plaintext size is known — the exact ciphertext size (24-byte header + 16-byte tag per 64 KiB segment) are checked.
verify_blob() { # <sha256> <rclone base path> [plaintext size]
  local hash=$1 base=$2 plain=${3:-} key size sum clen magic segs expect
  [[ $hash =~ ^[a-f0-9]{64}$ ]] || die "not a sha256 hex string: $hash"
  key="${hash:0:2}/${hash:2:2}/$hash"
  if size=$(rclone size --json "$base/$key" 2>/dev/null) && (($(jq .count <<<"$size") == 1)); then
    sum=$(rclone cat "$base/$key" | sha256sum | cut -d' ' -f1)
    if [[ $sum == "$hash" ]]; then
      printf '  ok        %s  (%s bytes, sha256 = content address)\n' "$hash" "$(jq .bytes <<<"$size")"
      return 0
    fi
    printf '  CORRUPT   %s  sha256 of the stored object is %s\n' "$hash" "$sum"
    return 1
  elif size=$(rclone size --json "$base/$key.enc" 2>/dev/null) && (($(jq .count <<<"$size") == 1)); then
    clen=$(jq .bytes <<<"$size")
    magic=$(rclone cat --count 4 "$base/$key.enc")
    if [[ $magic != CSS1 ]]; then
      printf '  CORRUPT   %s.enc  bad header (not a CadSandbox encrypted stream)\n' "$hash"
      return 1
    fi
    if [[ -n $plain ]]; then
      segs=$(((plain + 65535) / 65536))
      ((segs > 0)) || segs=1
      expect=$((24 + plain + 16 * segs))
      if ((clen == expect)); then
        printf '  ok        %s.enc  (%s bytes; app-level encrypted — header and size match, content needs STORAGE_ENCRYPTION_KEY)\n' "$hash" "$clen"
      else
        printf '  WARN      %s.enc  %s bytes, %s expected for %s plaintext bytes — open it in a restored app instance\n' "$hash" "$clen" "$expect" "$plain"
      fi
    else
      printf '  ok        %s.enc  (%s bytes; app-level encrypted — header ok, content needs STORAGE_ENCRYPTION_KEY)\n' "$hash" "$clen"
    fi
    return 0
  fi
  printf '  MISSING   %s\n' "$hash"
  return 1
}

blob_base() { # [bucket[/prefix]] → rclone path to verify against
  if [[ -n ${1:-} ]]; then
    local b="src:${1#/}"
    printf '%s' "${b%/}"
  else
    printf 'blobs:current'
  fi
}

cmd_verify_blob() {
  local hash='' in=''
  while (($#)); do
    case $1 in
      --in) in=$2; shift 2 ;;
      -*) die "verify-blob: unknown argument $1" ;;
      *) hash=$1; shift ;;
    esac
  done
  [[ -n $hash ]] || die "verify-blob: <sha256> is required"
  env_check || exit 1
  blobs_enabled || die "verify-blob: BACKUP_BLOBS=false — no blob mirror is configured"
  rclone_setup
  verify_blob "$hash" "$(blob_base "$in")"
}

cmd_verify_blobs() {
  local to='' in='' count=5 base bad=0 n=0 hash size
  while (($#)); do
    case $1 in
      --to) to=$2; shift 2 ;;
      --in) in=$2; shift 2 ;;
      --count) count=$2; shift 2 ;;
      *) die "verify-blobs: unknown argument $1" ;;
    esac
  done
  env_check || exit 1
  blobs_enabled || die "verify-blobs: BACKUP_BLOBS=false — no blob mirror is configured"
  [[ -n $to ]] || die "verify-blobs: --to <postgres-url> (the restored database) is required"
  [[ $count =~ ^[0-9]+$ ]] || die "verify-blobs: --count expects a number"
  rclone_setup
  base=$(blob_base "$in")
  log "sha256 spot check: $count random blobs listed in $(redact_url "$to"), objects read from $base"
  while IFS='|' read -r hash size; do
    [[ -n $hash ]] || continue
    n=$((n + 1))
    verify_blob "$hash" "$base" "$size" || bad=$((bad + 1))
  done < <(pqt "$to" "SELECT hash, size FROM blobs ORDER BY random() LIMIT $count")
  ((n > 0)) || die "verify-blobs: the blobs table is empty"
  ((bad == 0)) || die "verify-blobs: $bad of $n blobs failed"
  log "verify-blobs OK: $n/$n blobs verified"
}

# --- main ---------------------------------------------------------------------------------------

restore_usage() { sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,2\}//'; }

case ${1:-help} in
  snapshots) shift; env_check || exit 1; exec restic snapshots --host "$RESTIC_HOST" "$@" ;;
  db) shift; cmd_db "$@" ;;
  verify-db) shift; cmd_verify_db "$@" ;;
  blobs) shift; cmd_blobs "$@" ;;
  verify-blobs) shift; cmd_verify_blobs "$@" ;;
  verify-blob) shift; cmd_verify_blob "$@" ;;
  -h | --help | help) restore_usage ;;
  *) restore_usage >&2; exit 2 ;;
esac
