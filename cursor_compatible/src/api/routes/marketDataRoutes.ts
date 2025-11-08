import * as express from 'express';
import { MarketDataService } from '../services/marketDataService';

const router = express.Router();
const service = new MarketDataService();

/**
 * @openapi
 * /marketdata:
 *   get:
 *     summary: Get market data for a symbol and time range
 *     parameters:
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Market data
 */
router.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const { symbol, from, to } = req.query;
    if (!symbol || !from || !to) {
      return res.status(400).json({ error: 'Missing required query parameters' });
    }
    const data = await service.getMarketData(String(symbol), Number(from), Number(to));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * @openapi
 * /marketdata:
 *   post:
 *     summary: Insert new market data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MarketData'
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/', async (req: express.Request, res: express.Response) => {
  try {
    await service.insertMarketData(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router; 