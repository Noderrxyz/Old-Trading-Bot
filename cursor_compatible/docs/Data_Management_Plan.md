# Noderr Data Management Plan

## 1. Data Source Inventory

| Category      | Data Types                                                                 |
|--------------|----------------------------------------------------------------------------|
| Market Data  | L1_TICK (trades, quotes), L2_ORDERBOOK (order book), HISTORICAL (OHLCV), ALTERNATIVE (on-chain, sentiment, news) |
| Operational  | TRADES, ORDERS, POSITIONS, PNL                                             |
| Config       | STRATEGY_CONFIG, RISK_CONFIG, TRADING_HOURS, WHITELIST, BLACKLIST          |
| User         | USER_PROFILE, API_KEYS, PERMISSIONS, AUDIT_LOGS                            |

- **Canonical inventory:** [`src/types/DataSource.types.ts`](../src/types/DataSource.types.ts)

---

## 2. Ingestion Pipeline

- **Architecture:** Adapter pattern for each data source/provider
- **Adapters:** e.g., [`MarketDataAdapter`](../src/ingestion/MarketDataAdapter.ts), [`BinanceMarketDataAdapter`](../src/ingestion/BinanceMarketDataAdapter.ts)
- **Normalization:** Converts provider-specific data to canonical schema
- **Validation:** AJV-based, using JSON schemas ([`src/schemas/`](../src/schemas/))
- **Error Handling:** Robust, with reconnection, retries, and logging
- **Data Gaps/Late Arrivals:** Buffering and detection logic in adapters/services

**Pipeline Diagram:**
```
[Exchange/API] -> [Adapter] -> [Normalizer] -> [Validator] -> [Service/API] -> [Storage]
```

---

## 3. Data Storage Solution

### 3.1 Database Technologies
- **TimescaleDB:** Market data (hypertable, partitioned by time/symbol)
- **PostgreSQL:** Operational, config, user data (normalized tables)
- **Redis:** Caching/session management (future extension)

### 3.2 Schema Design, Indexing, Partitioning
- **Schemas:** [`src/schemas/`](../src/schemas/)
- **Migrations:** [`migrations/`](../migrations/)
- **Partitioning:** TimescaleDB hypertables, PostgreSQL indexes

### 3.3 Backup, Replication, Disaster Recovery
- **Scripts:** [`dbops/backup_timescaledb.sh`](../dbops/backup_timescaledb.sh), [`dbops/backup_postgres.sh`](../dbops/backup_postgres.sh)
- **Restore:** [`dbops/restore_timescaledb.sh`](../dbops/restore_timescaledb.sh), [`dbops/restore_postgres.sh`](../dbops/restore_postgres.sh)
- **Replication:** [`dbops/replication_timescaledb.md`](../dbops/replication_timescaledb.md), [`dbops/replication_postgres.md`](../dbops/replication_postgres.md)
- **DR Runbook:** [`dbops/DR_runbook.md`](../dbops/DR_runbook.md)

---

## 4. Data Access and API Layer

### 4.1 Service Classes
- **Market:** [`MarketDataService`](../src/api/services/marketDataService.ts)
- **Operational:** [`OperationalDataService`](../src/api/services/operationalDataService.ts)
- **User:** [`UserDataService`](../src/api/services/userDataService.ts)
- **Config:** [`ConfigDataService`](../src/api/services/configDataService.ts)

### 4.2 REST API Endpoints
- **Market Data:** `/api/marketdata` (GET, POST)
- **Operational Data:** `/api/operationaldata` (GET, POST)
- **User Data:** `/api/userdata` (GET, POST)
- **Config Data:** `/api/configdata` (GET, POST)
- **OpenAPI docs:** See route files in [`src/api/routes/`](../src/api/routes/)

**Example API Call:**
```http
GET /api/marketdata?symbol=BTCUSDT&from=1710000000&to=1710003600
```

---

## 5. Operational and Security Notes

- **Observability:** All errors and events are logged via the central logger.
- **Validation:** All data is schema-validated before storage.
- **No public authentication:** Internal API only (add auth if/when needed for external exposure).
- **Backups:** Automated, with offsite storage recommended.
- **Disaster Recovery:** Documented, tested, and ready for audit.
- **Extensibility:** New data types, adapters, and endpoints can be added with minimal friction.

---

## 6. Diagrams

**High-Level Data Flow:**
```
[Data Source] -> [Adapter] -> [Normalizer/Validator] -> [Service/API] -> [Database]
```

**Storage Architecture:**
```
[TimescaleDB: market_data]   [PostgreSQL: operational_data, user_data, config_data]
           |                                 |
        [Backup/DR]                      [Backup/DR]
```

---

## 7. References
- **Type definitions:** [`src/types/DataSource.types.ts`](../src/types/DataSource.types.ts)
- **Schemas:** [`src/schemas/`](../src/schemas/)
- **Migrations:** [`migrations/`](../migrations/)
- **DB Ops:** [`dbops/`](../dbops/)
- **API Services:** [`src/api/services/`](../src/api/services/)
- **API Routes:** [`src/api/routes/`](../src/api/routes/)

---

**This document, together with the referenced code and scripts, constitutes a complete, production-grade Data Management Plan for Noderr.** 