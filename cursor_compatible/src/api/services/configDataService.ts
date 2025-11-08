// NOTE: Ensure 'ajv' is installed and 'resolveJsonModule' is enabled in tsconfig.json
import { Pool } from 'pg';
import Ajv from 'ajv';
import configDataSchema from '../../schemas/ConfigData.schema.json';

const ajv = new Ajv();
const validate = ajv.compile(configDataSchema);

const pool = new Pool();

export class ConfigDataService {
  async getConfigData(type: string, from: number, to: number) {
    const res = await pool.query(
      'SELECT * FROM config_data WHERE type = $1 AND timestamp BETWEEN $2 AND $3 ORDER BY timestamp ASC',
      [type, from, to]
    );
    return res.rows;
  }

  async insertConfigData(data: any) {
    if (!validate(data)) {
      throw new Error('Invalid config data: ' + JSON.stringify(validate.errors));
    }
    await pool.query(
      'INSERT INTO config_data (id, type, timestamp, payload) VALUES ($1, $2, $3, $4)',
      [data.id, data.type, data.timestamp, data.payload]
    );
  }
} 