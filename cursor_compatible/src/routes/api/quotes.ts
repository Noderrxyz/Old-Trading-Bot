import express from 'express';
import { JSONSchemaType } from 'ajv';
import { authenticate } from '../../auth/authMiddleware';
import { validateBody } from '../../middleware/validationMiddleware';

// Paper-mode SOR imports from execution package
// High: use paper adapter registry and flags to avoid live calls
import { SmartOrderRouter } from '../../../packages/execution/src/SmartOrderRouter';
import { buildPaperExchanges } from '../../../packages/execution/src/PaperAdapterRegistry';
import { loadSorFlags } from '../../../packages/execution/src/config';
import { Order, OrderSide, OrderType, RoutingConfig, Exchange } from '../../../packages/execution/src/types';

const router = express.Router();

interface QuoteBody {
  base: string;
  quote: string;
  amount: string;
  side: 'buy' | 'sell';
}

const quoteSchema: JSONSchemaType<QuoteBody> = {
  type: 'object',
  properties: {
    base: { type: 'string' },
    quote: { type: 'string' },
    amount: { type: 'string' },
    side: { type: 'string', enum: ['buy', 'sell'] as any },
  },
  required: ['base', 'quote', 'amount', 'side'],
  additionalProperties: false,
};

// Minimal Winston-like logger adapter to satisfy SOR expectations (High)
const makeLogger = () => ({
  info: (...args: any[]) => console.log('[SOR]', ...args),
  debug: (...args: any[]) => console.log('[SOR]', ...args),
  warn: (...args: any[]) => console.warn('[SOR]', ...args),
  error: (...args: any[]) => console.error('[SOR]', ...args),
}) as any;

// Paper-mode quote endpoint
router.post(
  '/quote',
  authenticate,
  validateBody<QuoteBody>(quoteSchema),
  async (req, res) => {
    const { base, quote, amount, side } = req.body as QuoteBody;
    const symbol = `${base}/${quote}`;
    const qty = Number(amount);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    try {
      const flags = loadSorFlags();
      // Build paper exchanges and ensure symbol is supported
      const exchanges: Exchange[] = buildPaperExchanges(flags.enabledVenues).map((ex) => ({
        ...ex,
        supportedPairs: Array.from(new Set([...(ex.supportedPairs || []), symbol])),
      }));

      const config: RoutingConfig = {
        mode: 'smart',
        splitThreshold: 1000,
        maxSplits: 3,
        routingObjective: 'balanced',
        venueAnalysis: false,
        darkPoolAccess: false,
        crossVenueArbitrage: false,
        latencyOptimization: false,
        mevProtection: false,
      };

      const sor = new SmartOrderRouter(config, makeLogger(), exchanges);
      const order: Order = {
        id: `q-${Date.now()}`,
        symbol,
        side: side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
        type: OrderType.MARKET,
        quantity: qty,
        timestamp: Date.now(),
        metadata: { isSimulation: true },
      };

      const decision = await sor.routeOrder(order);
      res.json({ ok: true, decision });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
);

export default router;



