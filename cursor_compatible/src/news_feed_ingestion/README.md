# News Feed Ingestion Module

This module provides functionality for ingesting news from various cryptocurrency and financial news sources. It is designed to be extensible, allowing for easy addition of new news sources through source handlers.

## Architecture

The module consists of:

1. **NewsIngestionService**: Main service that manages the polling and processing of news from various sources.
2. **Source Handlers**: Implementations for specific news sources (e.g., CryptoPanic).
3. **Utilities**: Helper functions for processing and formatting headlines.

## How it Works

1. The `NewsIngestionService` polls registered source handlers at a configurable interval.
2. Each source handler fetches headlines from its source and converts them to a standardized `RawHeadline` format.
3. Callbacks registered with the service process these headlines (for example, sending them to a classification pipeline).
4. The service manages concurrent fetches and handles errors appropriately.

## Usage

### Basic Setup

```typescript
import { setupNewsIngestionService, NewsIngestionService, CryptoPanicHandler } from './news_feed_ingestion';

// Option 1: Use the convenience setup function
const service = await setupNewsIngestionService({
  cryptoPanicApiKey: 'your-api-key',
  pollingIntervalMs: 300000, // 5 minutes
  autoStartPolling: true
});

// Option 2: Manual setup for more control
const manualService = new NewsIngestionService({
  pollingIntervalMs: 300000,
  autoStartPolling: false
});

const cryptoPanicHandler = new CryptoPanicHandler({
  apiKey: 'your-api-key',
  name: 'CryptoPanic',
  currencies: ['BTC', 'ETH', 'SOL']
});

manualService.addSourceHandler(cryptoPanicHandler);
manualService.startPolling();
```

### Processing Headlines

Register a callback to process headlines as they come in:

```typescript
service.onNewHeadlines(async (headlines) => {
  console.log(`Received ${headlines.length} new headlines`);
  
  // Process headlines (e.g., classify, index, store, etc.)
  for (const headline of headlines) {
    // Do something with each headline
  }
});
```

## Adding New Source Handlers

Create a new class that extends `BaseSourceHandler` and implement the required methods:

```typescript
export class MyNewSourceHandler extends BaseSourceHandler {
  constructor(config: NewsSourceConfig) {
    super({
      ...config,
      name: 'MyNewsSource'
    });
  }

  public async fetchHeadlines(): Promise<FetchResult> {
    // Implementation for fetching headlines
  }

  protected processApiResponse(response: any): RawHeadline[] {
    // Implementation for processing API response
  }
}
```

## Dependencies

- axios: For HTTP requests
- Node.js environment

## Future Improvements

1. Add more source handlers (e.g., CoinDesk, CoinTelegraph, Bloomberg)
2. Add support for RSS feeds
3. Implement a more sophisticated duplicate detection algorithm
4. Add caching layer to avoid refetching recent headlines
5. Add rate limiting and backoff strategies for API calls 