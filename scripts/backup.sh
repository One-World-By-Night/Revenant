#!/usr/bin/env bash
#
# Backs up the bot's own Postgres database to a timestamped, gzipped dump.
#
# Usage:
#   DATABASE_URL=postgres://... scripts/backup.sh
#   BACKUP_DIR=/path/to/backups scripts/backup.sh   (default: ./backups)
#   BACKUP_RETAIN_DAYS=30 scripts/backup.sh          (default: 14)
#   PG_DUMP=/path/to/pg_dump scripts/backup.sh       (default: pg_dump on PATH)
#
# pg_dump refuses to dump a server newer than itself. Set PG_DUMP to a client at least as new as the
# database server when the one on PATH is older (Homebrew's default postgresql formula often is).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is required." >&2
	exit 1
fi

PG_DUMP="${PG_DUMP:-pg_dump}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/berevenant-$TIMESTAMP.sql.gz"

"$PG_DUMP" "$DATABASE_URL" | gzip > "$OUT_FILE"
echo "Backed up to $OUT_FILE"

find "$BACKUP_DIR" -name 'berevenant-*.sql.gz' -mtime "+$RETAIN_DAYS" -delete
