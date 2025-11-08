# Noderr Database Operations (dbops)

## Overview
This directory contains all scripts and documentation for production-grade database operations, including backup, restore, replication, and disaster recovery for TimescaleDB and PostgreSQL.

## Contents
- `backup_timescaledb.sh`: Automated backup for TimescaleDB (market data)
- `backup_postgres.sh`: Automated backup for PostgreSQL (operational, user, config data)
- `restore_timescaledb.sh`: Restore script for TimescaleDB backups
- `restore_postgres.sh`: Restore script for PostgreSQL backups
- `replication_timescaledb.md`: Streaming replication setup for TimescaleDB
- `replication_postgres.md`: Streaming replication setup for PostgreSQL
- `DR_runbook.md`: Disaster recovery runbook for all databases

## Usage
- **Backups:** Run the backup scripts on a schedule (e.g., via cron) to ensure regular backups. Store backups offsite for DR.
- **Restores:** Use the restore scripts to recover from backup files. Always verify data integrity after restore.
- **Replication:** Follow the replication guides to set up high-availability replicas. Regularly test failover.
- **Disaster Recovery:** Follow the DR runbook in the event of a failure or disaster. Notify stakeholders and document incidents.

## Best Practices
- Automate backups and monitor for failures.
- Regularly test restores and failover procedures.
- Secure backup files and restrict access.
- Monitor replication lag and database health.
- Keep all scripts and documentation up to date. 