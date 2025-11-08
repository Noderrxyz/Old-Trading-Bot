import * as express from 'express';
import { OperationalDataService } from '../services/operationalDataService';

const router = express.Router();
const service = new OperationalDataService();

/**
 * @openapi
 * /operationaldata:
 *   get:
 *     summary: Get operational data for a type, user, symbol, and time range
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: user
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Operational data
 */
router.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const { type, user, symbol, from, to } = req.query;
    if (!type || !user || !symbol || !from || !to) {
      return res.status(400).json({ error: 'Missing required query parameters' });
    }
    const data = await service.getOperationalData(String(type), String(user), String(symbol), Number(from), Number(to));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * @openapi
 * /operationaldata:
 *   post:
 *     summary: Insert new operational data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OperationalData'
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/', async (req: express.Request, res: express.Response) => {
  try {
    await service.insertOperationalData(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router; 