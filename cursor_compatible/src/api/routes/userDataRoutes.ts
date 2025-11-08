import * as express from 'express';
import { UserDataService } from '../services/userDataService';

const router = express.Router();
const service = new UserDataService();

/**
 * @openapi
 * /userdata:
 *   get:
 *     summary: Get user data for a type, user_id, and time range
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: user_id
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
 *         description: User data
 */
router.get('/', async (req: express.Request, res: express.Response) => {
  try {
    const { type, user_id, from, to } = req.query;
    if (!type || !user_id || !from || !to) {
      return res.status(400).json({ error: 'Missing required query parameters' });
    }
    const data = await service.getUserData(String(type), String(user_id), Number(from), Number(to));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * @openapi
 * /userdata:
 *   post:
 *     summary: Insert new user data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserData'
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/', async (req: express.Request, res: express.Response) => {
  try {
    await service.insertUserData(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router; 