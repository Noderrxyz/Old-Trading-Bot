import { logger } from '../utils/logger';
import * as crypto from 'crypto';

export interface SecureMessage {
  id: string;
  timestamp: number;
  type: string;
  payload: any;
  signature: string;
}

export class SecureProtocol {
  private static instance: SecureProtocol;
  private readonly PRIVATE_KEY: crypto.KeyObject;
  private readonly PUBLIC_KEY: crypto.KeyObject;
  private readonly ALGORITHM = 'RSA-SHA256';

  private constructor() {
    const { privateKey, publicKey } = this.generateKeys();
    this.PRIVATE_KEY = privateKey;
    this.PUBLIC_KEY = publicKey;
  }

  public static getInstance(): SecureProtocol {
    if (!SecureProtocol.instance) {
      SecureProtocol.instance = new SecureProtocol();
    }
    return SecureProtocol.instance;
  }

  private generateKeys(): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
    return {
      privateKey: crypto.createPrivateKey(privateKey),
      publicKey: crypto.createPublicKey(publicKey)
    };
  }

  public createMessage(type: string, payload: any): SecureMessage {
    const message: SecureMessage = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      payload,
      signature: ''
    };
    message.signature = this.signMessage(message);
    return message;
  }

  private signMessage(message: Omit<SecureMessage, 'signature'>): string {
    const sign = crypto.createSign(this.ALGORITHM);
    const messageString = JSON.stringify({
      id: message.id,
      timestamp: message.timestamp,
      type: message.type,
      payload: message.payload
    });
    sign.update(messageString);
    return sign.sign(this.PRIVATE_KEY, 'base64');
  }

  public verifyMessage(message: SecureMessage): boolean {
    try {
      const verify = crypto.createVerify(this.ALGORITHM);
      const messageString = JSON.stringify({
        id: message.id,
        timestamp: message.timestamp,
        type: message.type,
        payload: message.payload
      });
      verify.update(messageString);
      return verify.verify(this.PUBLIC_KEY, message.signature, 'base64');
    } catch (error) {
      logger.error('Failed to verify message:', error);
      return false;
    }
  }

  public encryptPayload(payload: any, publicKey: crypto.KeyObject): string {
    const buffer = Buffer.from(JSON.stringify(payload));
    const encrypted = crypto.publicEncrypt(publicKey, buffer);
    return encrypted.toString('base64');
  }

  public decryptPayload(encrypted: string): any {
    try {
      const buffer = Buffer.from(encrypted, 'base64');
      const decrypted = crypto.privateDecrypt(this.PRIVATE_KEY, buffer);
      return JSON.parse(decrypted.toString());
    } catch (error) {
      logger.error('Failed to decrypt payload:', error);
      throw error;
    }
  }

  public getPublicKey(): string {
    return this.PUBLIC_KEY.export({ type: 'spki', format: 'pem' }).toString();
  }

  public async handshake(remotePublicKey: string): Promise<boolean> {
    try {
      const remoteKey = crypto.createPublicKey(remotePublicKey);
      const challenge = crypto.randomBytes(32).toString('base64');
      const encryptedChallenge = this.encryptPayload(challenge, remoteKey);
      
      // In a real implementation, this would be sent to the remote node
      // and the response would be verified
      return true;
    } catch (error) {
      logger.error('Handshake failed:', error);
      return false;
    }
  }
} 