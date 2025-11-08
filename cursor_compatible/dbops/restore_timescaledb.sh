#!/bin/bash
set -euo pipefail
if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  exit 1
fi
BACKUP_FILE="$1"
DB_NAME="noderr"
echo "[INFO] Restoring TimescaleDB from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | pg_restore -d "$DB_NAME" --clean --if-exists
echo "[INFO] Restore complete." 