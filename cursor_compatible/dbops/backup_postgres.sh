#!/bin/bash
set -euo pipefail
BACKUP_DIR="/var/backups/postgres"
DB_NAME="noderr"
TABLES=("operational_data" "user_data" "config_data")
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
echo "[INFO] Starting PostgreSQL backup at $DATE..."
for TABLE in "${TABLES[@]}"; do
  BACKUP_FILE="$BACKUP_DIR/${TABLE}_$DATE.sql.gz"
  pg_dump -Fc -d "$DB_NAME" -t "$TABLE" | gzip > "$BACKUP_FILE"
  echo "[INFO] Backup complete: $BACKUP_FILE"
done 