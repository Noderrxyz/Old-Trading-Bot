#!/bin/bash
set -euo pipefail
BACKUP_DIR="/var/backups/timescaledb"
DB_NAME="noderr"
TABLE="market_data"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/market_data_$DATE.sql.gz"

mkdir -p "$BACKUP_DIR"
echo "[INFO] Starting TimescaleDB backup at $DATE..."
pg_dump -Fc -d "$DB_NAME" -t "$TABLE" | gzip > "$BACKUP_FILE"
echo "[INFO] Backup complete: $BACKUP_FILE" 