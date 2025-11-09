# Deprecated Code Archive

This directory contains code that has been deprecated and removed from the active codebase. Files are archived here for historical reference and potential future use, but should NOT be used in production.

## Mock Connectors (`mock_connectors/`)

**Archived:** November 9, 2025  
**Reason:** These are mock implementations of exchange connectors that were used for testing and development. They should be replaced with real exchange connectors in production.

**Files:**
- `MockExchangeConnector.ts` - Basic mock exchange connector
- `RealisticExchangeConnector.ts` - More realistic mock with simulated latency and errors
- `test-realistic-exchange.ts` - Test file for RealisticExchangeConnector

**Replacement:** Real exchange connectors should be implemented in `packages/exchanges/` or `src/execution/connectors/` using official exchange APIs (Binance, Coinbase, Kraken, etc.).

**Reference:** See `AUDIT/ATE_AUDIT/VERIFIED_DELETION_LIST.md` for the full audit report.

---

**Note:** Files in this directory are preserved in git history and can be recovered if needed using `git checkout <commit>`.
