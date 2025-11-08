// NOTE: Ensure 'ajv' is installed and 'resolveJsonModule' is enabled in tsconfig.json
import { Pool } from 'pg';
import Ajv from 'ajv';
import userDataSchema from '../../schemas/UserData.schema.json';

const ajv = new Ajv();
const validate = ajv.compile(userDataSchema);

const pool = new Pool();

export class UserDataService {
  async getUserData(type: string, user_id: string, from: number, to: number) {
    const res = await pool.query(
      'SELECT * FROM user_data WHERE type = $1 AND user_id = $2 AND timestamp BETWEEN $3 AND $4 ORDER BY timestamp ASC',
      [type, user_id, from, to]
    );
    return res.rows;
  }

  async insertUserData(data: any) {
    if (!validate(data)) {
      throw new Error('Invalid user data: ' + JSON.stringify(validate.errors));
    }
    await pool.query(
      'INSERT INTO user_data (type, user_id, timestamp, payload) VALUES ($1, $2, $3, $4)',
      [data.type, data.user_id, data.timestamp, data.payload]
    );
  }
} 