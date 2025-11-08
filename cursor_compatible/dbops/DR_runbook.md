# Disaster Recovery (DR) Runbook: Noderr Databases

## Overview
This runbook provides step-by-step instructions for recovering TimescaleDB and PostgreSQL databases in the event of a failure or disaster.

---

## 1. Restore from Backup

### TimescaleDB (Market Data)
1. Identify the most recent valid backup file (e.g., `/var/backups/timescaledb/market_data_<timestamp>.sql.gz`).
2. Stop all application services that write to the database.
3. Restore the backup:
   ```sh
   ./restore_timescaledb.sh /path/to/backup.sql.gz
   ```
4. Start application services.

### PostgreSQL (Operational, User, Config Data)
1. Identify the most recent valid backup file for each table (e.g., `/var/backups/postgres/operational_data_<timestamp>.sql.gz`).
2. Stop all application services that write to the database.
3. Restore the backup:
   ```sh
   ./restore_postgres.sh /path/to/backup.sql.gz
   ```
4. Start application services.

---

## 2. Failover to Replica
1. Promote the replica to primary:
   ```sh
   pg_ctl promote -D /var/lib/postgresql/data
   ```
2. Update application connection strings to point to the new primary.
3. Reconfigure the old primary as a replica if possible.

---

## 3. Verification
- Check database logs for errors.
- Run health checks and application tests.
- Verify data integrity and recentness.

---

## 4. Post-Recovery Steps
- Notify stakeholders of recovery status.
- Review and document the incident.
- Schedule a post-mortem and update DR procedures as needed. 