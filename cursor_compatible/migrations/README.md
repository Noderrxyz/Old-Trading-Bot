# Noderr Database Migrations

## Overview
This directory contains SQL migration scripts for all Noderr data schemas, including TimescaleDB (market data) and PostgreSQL (operational, user, config data).

## Migration Scripts
- `001_create_market_data_timescaledb.sql`: TimescaleDB hypertable for market data (partitioned by timestamp, indexed by symbol/source)
- `002_create_operational_data_postgres.sql`: PostgreSQL table for operational data (trades, orders, positions, P&L)
- `003_create_user_data_postgres.sql`: PostgreSQL table for user data (profiles, API keys, permissions, audit logs)
- `004_create_config_data_postgres.sql`: PostgreSQL table for config data (strategy, risk, trading hours, whitelist, blacklist)

## Applying Migrations
1. Ensure TimescaleDB and PostgreSQL are installed and running.
2. Apply each migration in order using `psql` or your preferred migration tool:
   ```sh
   psql -d <dbname> -f 001_create_market_data_timescaledb.sql
   psql -d <dbname> -f 002_create_operational_data_postgres.sql
   psql -d <dbname> -f 003_create_user_data_postgres.sql
   psql -d <dbname> -f 004_create_config_data_postgres.sql
   ```
3. Verify tables, indexes, and hypertables are created as expected.

## Best Practices
- Use versioned migration scripts for all schema changes.
- Regularly back up databases before applying migrations.
- Monitor index usage and partitioning for performance. 