/**
 * API Key Management Module
 * 
 * This module provides functionality for managing API keys.
 * It's designed to be replaced with a HashiCorp Vault integration in production.
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ApiKey, Permission } from './types';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('ApiKeyManager');

// In-memory storage for API keys (will be replaced with Vault/DB in production)
const apiKeyStorage = new Map<string, ApiKey>();
const apiKeyHashes = new Map<string, string>();

/**
 * Generate a new API key
 * 
 * @param userId User ID for the key owner
 * @param name A descriptive name for the key
 * @param permissions Permissions granted to this key
 * @param expiresInDays Optional expiration in days (undefined = no expiration)
 * @returns The created API key object and the actual key (shown only once)
 */
export function generateApiKey(
  userId: string,
  name: string,
  permissions: Permission[],
  expiresInDays?: number
): { apiKey: ApiKey; actualKey: string } {
  // Generate a secure random key
  const actualKey = `ndr_${uuidv4().replace(/-/g, '')}_${crypto.randomBytes(16).toString('hex')}`;
  
  // Create the API key object
  const keyId = uuidv4();
  const keyPrefix = actualKey.substring(0, 12);
  
  const apiKey: ApiKey = {
    id: keyId,
    userId,
    name,
    keyPrefix,
    permissions,
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : undefined,
    createdAt: new Date(),
    isActive: true
  };
  
  // Store a hash of the key for validation
  const keyHash = hashApiKey(actualKey);
  apiKeyHashes.set(keyId, keyHash);
  
  // Store the API key metadata
  apiKeyStorage.set(keyId, apiKey);
  
  logger.info('API key generated', {
    userId,
    keyId,
    keyPrefix,
    expiresAt: apiKey.expiresAt?.toISOString()
  });
  
  return { apiKey, actualKey };
}

/**
 * Validate an API key
 * 
 * @param apiKey The API key to validate
 * @returns The API key object if valid, undefined if invalid
 */
export function validateApiKey(apiKey: string): ApiKey | undefined {
  // Extract the key ID from the key (in a real implementation,
  // we might use a more sophisticated approach)
  const keyPrefix = apiKey.substring(0, 12);
  
  // Find the key by prefix
  const matchingKey = Array.from(apiKeyStorage.values()).find(k => 
    k.keyPrefix === keyPrefix && k.isActive
  );
  
  if (!matchingKey) {
    logger.debug('API key validation failed: No matching key found', { keyPrefix });
    return undefined;
  }
  
  // Check if key is expired
  if (matchingKey.expiresAt && matchingKey.expiresAt < new Date()) {
    logger.debug('API key validation failed: Key expired', { 
      keyId: matchingKey.id,
      keyPrefix,
      expiresAt: matchingKey.expiresAt.toISOString()
    });
    return undefined;
  }
  
  // Verify the key hash
  const storedHash = apiKeyHashes.get(matchingKey.id);
  if (!storedHash) {
    logger.warn('API key validation failed: No hash found', { 
      keyId: matchingKey.id,
      keyPrefix
    });
    return undefined;
  }
  
  const inputHash = hashApiKey(apiKey);
  if (inputHash !== storedHash) {
    logger.warn('API key validation failed: Invalid hash', { 
      keyId: matchingKey.id,
      keyPrefix
    });
    return undefined;
  }
  
  // Update last used timestamp
  matchingKey.lastUsed = new Date();
  apiKeyStorage.set(matchingKey.id, matchingKey);
  
  return matchingKey;
}

/**
 * Revoke an API key
 * 
 * @param keyId The ID of the key to revoke
 * @returns true if key was revoked, false if not found
 */
export function revokeApiKey(keyId: string): boolean {
  const apiKey = apiKeyStorage.get(keyId);
  
  if (!apiKey) {
    logger.warn('API key revocation failed: Key not found', { keyId });
    return false;
  }
  
  // Deactivate the key
  apiKey.isActive = false;
  apiKeyStorage.set(keyId, apiKey);
  
  logger.info('API key revoked', {
    keyId,
    userId: apiKey.userId,
    keyPrefix: apiKey.keyPrefix
  });
  
  return true;
}

/**
 * List all API keys for a user
 * 
 * @param userId The user ID to list keys for
 * @returns Array of API key objects (without the actual keys)
 */
export function listApiKeys(userId: string): ApiKey[] {
  return Array.from(apiKeyStorage.values())
    .filter(key => key.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Get details for a specific API key
 * 
 * @param keyId The ID of the key to get
 * @returns The API key object if found, undefined if not
 */
export function getApiKey(keyId: string): ApiKey | undefined {
  return apiKeyStorage.get(keyId);
}

/**
 * Hash an API key for secure storage
 * 
 * @param apiKey The API key to hash
 * @returns The hashed API key
 */
function hashApiKey(apiKey: string): string {
  return crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex');
}

/**
 * Future HashiCorp Vault integration points:
 * 
 * 1. Replace in-memory storage with Vault's key-value store
 * 2. Use Vault's dynamic secrets for API key generation
 * 3. Leverage Vault's token capabilities for automatic expiration
 * 4. Use Vault's audit logging for complete access history
 */

export default {
  generateApiKey,
  validateApiKey,
  revokeApiKey,
  listApiKeys,
  getApiKey
}; 