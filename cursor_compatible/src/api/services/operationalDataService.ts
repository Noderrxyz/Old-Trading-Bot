// NOTE: Ensure 'ajv' is installed and 'resolveJsonModule' is enabled in tsconfig.json
import { Pool } from 'pg';
import Ajv from 'ajv';
import operationalDataSchema from '../../schemas/OperationalData.schema.json';

const ajv = new Ajv();
const validate = ajv.compile(operationalDataSchema);

const pool = new Pool();

export class OperationalDataService {
  async getOperationalData(type: string, user: string, symbol: string, from: number, to: number) {
    const res = await pool.query(
      'SELECT * FROM operational_data WHERE type = $1 AND user_id = $2 AND symbol = $3 AND timestamp BETWEEN $4 AND $5 ORDER BY timestamp ASC',
      [type, user, symbol, from, to]
    );
    return res.rows;
  }

  async insertOperationalData(data: any) {
    if (!validate(data)) {
      throw new Error('Invalid operational data: ' + JSON.stringify(validate.errors));
    }
    await pool.query(
      'INSERT INTO operational_data (id, type, user_id, symbol, timestamp, payload) VALUES ($1, $2, $3, $4, $5, $6)',
      [data.id, data.type, data.user, data.symbol, data.timestamp, data.payload]
    );
  }
} 