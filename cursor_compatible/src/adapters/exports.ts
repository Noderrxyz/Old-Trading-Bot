/**
 * Paper Mode Adapter Exports
 * 
 * Export file specifically for paper mode adapter functionality.
 */

// Interfaces
export type {
  IExchangeConnector,
  OrderRequest,
  OrderResponse,
  OrderBook,
  Quote,
  TradeHistory,
  ExchangeStatus,
  BalanceInfo
} from './interfaces/IExchangeConnector';

export type {
  IRPCProvider,
  BlockInfo,
  TransactionInfo,
  TransactionReceipt,
  LogEntry,
  GasEstimate,
  NetworkStatus,
  ContractCallRequest,
  ContractCallResult
} from './interfaces/IRPCProvider';

// Mock Implementations
export { MockExchangeConnector } from './mock/MockExchangeConnector';
export { MockRPCProvider } from './mock/MockRPCProvider';

// Factories
export {
  ExchangeConnectorFactory,
  RPCProviderFactory,
  getExchangeConnector,
  getRPCProvider,
  createCommonExchangeConnectors,
  createCommonRPCProviders,
  cleanupAllAdapters,
  getAdapterStatistics
} from './factories/AdapterFactory'; 