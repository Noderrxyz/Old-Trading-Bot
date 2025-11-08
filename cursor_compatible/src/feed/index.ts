import { FeedGraphUpdatesServer } from './feed_graph_updates';
import { FeedGraphEngine } from './FeedGraphEngine';

// Initialize the feed graph server
const feedGraphServer = FeedGraphUpdatesServer.getInstance();

// Export components
export * from './FeedGraphEngine';
export * from './feed_graph_updates';

// Cleanup function
export function cleanup(): void {
  feedGraphServer.cleanup();
  FeedGraphEngine.getInstance().cleanup();
} 