// NOTE: Ensure 'ajv' is installed: npm install ajv
// NOTE: Enable 'resolveJsonModule' in tsconfig.json to import JSON schemas
import { Pool } from 'pg';
import Ajv from 'ajv';
import marketDataSchema from '../../schemas/MarketData.schema.json';

const ajv = new Ajv();
const validate = ajv.compile(marketDataSchema);

const pool = new Pool(); // Configure with env vars or config file

export class MarketDataService {
  async getMarketData(symbol: string, from: number, to: number) {
    const res = await pool.query(
      'SELECT * FROM market_data WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3 ORDER BY timestamp ASC',
      [symbol, from, to]
    );
    return res.rows;
  }

  async insertMarketData(data: any) {
    if (!validate(data)) {
      throw new Error('Invalid market data: ' + JSON.stringify(validate.errors));
    }
    await pool.query(
      'INSERT INTO market_data (source, symbol, timestamp, type, data) VALUES ($1, $2, $3, $4, $5)',
      [data.source, data.symbol, data.timestamp, data.type, data.data]
    );
  }
} 