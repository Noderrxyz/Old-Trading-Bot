import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ApiKey {
  id: string;
  name: string;
  exchange: string;
  permissions: string[];
  lastUsed?: number;
  createdAt: number;
  expiresAt?: number;
}

export class KeyManager {
  private static instance: KeyManager;
  private readonly KEYS_FILE = 'data/api_keys.json';
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly IV_LENGTH = 16;
  private readonly ALGORITHM = 'aes-256-gcm';

  private constructor() {
    this.ENCRYPTION_KEY = this.getEncryptionKey();
    this.ensureKeysFile();
  }

  public static getInstance(): KeyManager {
    if (!KeyManager.instance) {
      KeyManager.instance = new KeyManager();
    }
    return KeyManager.instance;
  }

  private getEncryptionKey(): Buffer {
    // In a real implementation, this would be securely stored and rotated
    const key = process.env.ENCRYPTION_KEY || 'default-key-for-development';
    return crypto.scryptSync(key, 'salt', 32);
  }

  private ensureKeysFile() {
    const dir = path.dirname(this.KEYS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.KEYS_FILE)) {
      fs.writeFileSync(this.KEYS_FILE, JSON.stringify([]));
    }
  }

  public async addKey(key: ApiKey): Promise<void> {
    try {
      const keys = await this.getKeys();
      keys.push(key);
      await this.saveKeys(keys);
      logger.info(`Added new API key for ${key.exchange}`);
    } catch (error) {
      logger.error('Failed to add API key:', error);
      throw error;
    }
  }

  public async getKey(id: string): Promise<ApiKey | null> {
    const keys = await this.getKeys();
    return keys.find(k => k.id === id) || null;
  }

  public async getKeys(): Promise<ApiKey[]> {
    try {
      const encryptedData = fs.readFileSync(this.KEYS_FILE, 'utf-8');
      const data = this.decrypt(encryptedData);
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to get API keys:', error);
      return [];
    }
  }

  public async updateKey(id: string, updates: Partial<ApiKey>): Promise<void> {
    try {
      const keys = await this.getKeys();
      const index = keys.findIndex(k => k.id === id);
      if (index === -1) {
        throw new Error(`Key with ID ${id} not found`);
      }
      keys[index] = { ...keys[index], ...updates };
      await this.saveKeys(keys);
      logger.info(`Updated API key ${id}`);
    } catch (error) {
      logger.error('Failed to update API key:', error);
      throw error;
    }
  }

  public async deleteKey(id: string): Promise<void> {
    try {
      const keys = await this.getKeys();
      const filteredKeys = keys.filter(k => k.id !== id);
      await this.saveKeys(filteredKeys);
      logger.info(`Deleted API key ${id}`);
    } catch (error) {
      logger.error('Failed to delete API key:', error);
      throw error;
    }
  }

  public async rotateKey(id: string): Promise<void> {
    try {
      const key = await this.getKey(id);
      if (!key) {
        throw new Error(`Key with ID ${id} not found`);
      }
      const newKey = {
        ...key,
        id: crypto.randomUUID(),
        createdAt: Date.now()
      };
      await this.addKey(newKey);
      await this.deleteKey(id);
      logger.info(`Rotated API key ${id}`);
    } catch (error) {
      logger.error('Failed to rotate API key:', error);
      throw error;
    }
  }

  private async saveKeys(keys: ApiKey[]): Promise<void> {
    const data = JSON.stringify(keys);
    const encryptedData = this.encrypt(data);
    fs.writeFileSync(this.KEYS_FILE, encryptedData);
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return JSON.stringify({
      iv: iv.toString('hex'),
      encrypted,
      authTag: authTag.toString('hex')
    });
  }

  private decrypt(encryptedData: string): string {
    const { iv, encrypted, authTag } = JSON.parse(encryptedData);
    const decipher = crypto.createDecipheriv(
      this.ALGORITHM,
      this.ENCRYPTION_KEY,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
} 