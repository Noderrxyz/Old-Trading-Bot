# TimescaleDB Streaming Replication Guide

## Overview
This guide describes how to set up streaming replication for TimescaleDB (PostgreSQL) to ensure high availability and disaster recovery.

## Primary Node Configuration
1. Edit `postgresql.conf`:
   - `wal_level = replica`
   - `max_wal_senders = 10`
   - `wal_keep_size = 512MB`
   - `archive_mode = on`
   - `archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'`
2. Edit `pg_hba.conf` to allow replication connections from replicas:
   - `host replication all <replica_ip>/32 md5`
3. Restart PostgreSQL.

## Replica Node Setup
1. Stop PostgreSQL on the replica.
2. Clear old data directory:
   - `rm -rf /var/lib/postgresql/data/*`
3. Use `pg_basebackup` to copy data from primary:
   - `pg_basebackup -h <primary_ip> -D /var/lib/postgresql/data -U replicator -P -R`
4. Start PostgreSQL on the replica.

## Monitoring Replication
- Use `pg_stat_replication` on the primary to monitor replica status.
- Set up alerts for replication lag and failures.

## Failover Procedure
1. Promote replica to primary:
   - `pg_ctl promote -D /var/lib/postgresql/data`
2. Update application connection strings to point to the new primary.
3. Reconfigure old primary as a replica if needed.

## Best Practices
- Regularly test failover and backup procedures.
- Monitor WAL archive size and retention.
- Use strong passwords and network security for replication users. 