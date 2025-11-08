import * as express from 'express';
import { ConfigDataService } from '../services/configDataService';

const router = express.Router();
const service = new ConfigDataService();

/**
 * @openapi
 * /configdata:
 *   get:
 *     summary: Get config data for a type and time range
 *     parameters:
 *       - in: query
 *         name: type
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
 *         description: Config data
 */
router.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const { type, from, to } = req.query;
    if (!type || !from || !to) {
      return res.status(400).json({ error: 'Missing required query parameters' });
    }
    const data = await service.getConfigData(String(type), Number(from), Number(to));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * @openapi
 * /configdata:
 *   post:
 *     summary: Insert new config data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConfigData'
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/', async (req: express.Request, res: express.Response) => {
  try {
    await service.insertConfigData(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router; 