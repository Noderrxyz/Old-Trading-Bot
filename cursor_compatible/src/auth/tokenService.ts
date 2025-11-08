/**
 * JWT Token Service for authentication
 * 
 * This module handles JWT token generation, validation, and management
 * for user authentication and API key validation.
 */
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UserRole, Permission, JwtPayload } from './types';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('TokenService');

// Environment variables (fail-fast for non-test environments)
const IS_TEST_ENV = process.env.NODE_ENV === 'test';
const RAW_JWT_SECRET = process.env.JWT_SECRET;
const RAW_JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

// In tests, provide deterministic fallback secrets; in other envs, require explicit secrets
// Critical: ensure we never use undefined secrets in non-test envs and use only EFFECTIVE_* throughout
const EFFECTIVE_JWT_SECRET = RAW_JWT_SECRET ?? (IS_TEST_ENV ? 'test-jwt-secret' : undefined);
const EFFECTIVE_JWT_REFRESH_SECRET = RAW_JWT_REFRESH_SECRET ?? (IS_TEST_ENV ? 'test-jwt-refresh-secret' : undefined);

if (!IS_TEST_ENV && (!EFFECTIVE_JWT_SECRET || !EFFECTIVE_JWT_REFRESH_SECRET)) {
  // Fail fast with a clear, actionable error message
  throw new Error(
    'JWT configuration error: JWT_SECRET and JWT_REFRESH_SECRET must be set in the environment for non-test environments.'
  );
}

// Token blacklist (should be moved to Redis in production)
const tokenBlacklist = new Set<string>();

/**
 * Interface for token generation options
 */
interface GenerateTokenOptions {
  includeRefreshToken?: boolean;
  expiresIn?: string;
}

/**
 * Token response interface
 */
interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

/**
 * Verify token result interface
 */
interface VerifyTokenResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
}

/**
 * Generate JWT tokens for a user
 * 
 * @param userId User ID
 * @param username Username
 * @param roles User roles
 * @param permissions User permissions
 * @param options Token generation options
 * @returns Access token and optional refresh token
 */
export function generateTokens(
  userId: string,
  username: string,
  roles: UserRole[],
  permissions: Permission[],
  options: GenerateTokenOptions = {}
): TokenResponse {
  const jti = uuidv4();
  const expiresIn = options.expiresIn || JWT_EXPIRES_IN;
  
  // Calculate expiration date for client
  const expirySeconds = typeof expiresIn === 'string' 
    ? parseInt(expiresIn.replace(/\D/g, '')) * (expiresIn.includes('m') ? 60 : expiresIn.includes('h') ? 3600 : 86400)
    : expiresIn;
  const expiresAt = new Date(Date.now() + expirySeconds * 1000);

  // Create the JWT payload
  const payload: JwtPayload = {
    sub: userId,
    username,
    roles,
    permissions,
    jti,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000)
  };

  // Generate the access token
  // Critical: use EFFECTIVE_JWT_SECRET (previous code erroneously referenced JWT_SECRET)
  const accessToken = jwt.sign(payload, EFFECTIVE_JWT_SECRET as string, { expiresIn });

  const response: TokenResponse = {
    accessToken,
    expiresAt
  };

  // Generate a refresh token if requested
  if (options.includeRefreshToken) {
    const refreshPayload = {
      sub: userId,
      jti: uuidv4(),
      type: 'refresh'
    };

    response.refreshToken = jwt.sign(
      refreshPayload,
      EFFECTIVE_JWT_REFRESH_SECRET as string,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
  }

  logger.debug('Generated tokens for user', { 
    userId, 
    username,
    expiresAt: expiresAt.toISOString() 
  });

  return response;
}

/**
 * Verify an access token
 * 
 * @param token JWT token to verify
 * @returns Verification result with payload if valid
 */
export function verifyToken(token: string): VerifyTokenResult {
  try {
    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      return { 
        valid: false, 
        error: 'Token has been revoked' 
      };
    }

    // Verify the token
    // Critical: use EFFECTIVE_JWT_SECRET to verify
    const payload = jwt.verify(token, EFFECTIVE_JWT_SECRET as string) as JwtPayload;
    
    return { 
      valid: true, 
      payload 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Token verification failed', { error: errorMessage });
    
    return { 
      valid: false, 
      error: errorMessage 
    };
  }
}

/**
 * Verify a refresh token
 * 
 * @param token Refresh token to verify
 * @returns Verification result with payload if valid
 */
export function verifyRefreshToken(token: string): VerifyTokenResult {
  try {
    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      return { 
        valid: false, 
        error: 'Refresh token has been revoked' 
      };
    }

    // Verify the token
    const payload = jwt.verify(token, EFFECTIVE_JWT_REFRESH_SECRET as string) as any;
    
    // Ensure it's a refresh token
    if (payload.type !== 'refresh') {
      return { 
        valid: false, 
        error: 'Not a refresh token' 
      };
    }
    
    return { 
      valid: true, 
      payload 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Refresh token verification failed', { error: errorMessage });
    
    return { 
      valid: false, 
      error: errorMessage 
    };
  }
}

/**
 * Revoke a token by adding it to the blacklist
 * 
 * @param token Token to revoke
 * @returns Success indicator
 */
export function revokeToken(token: string): boolean {
  try {
    // Decode the token without verification to get the payload
    const decoded = jwt.decode(token) as JwtPayload;
    
    if (!decoded || !decoded.jti) {
      logger.warn('Failed to revoke token: Invalid token format');
      return false;
    }
    
    // Add the token's JTI to the blacklist
    tokenBlacklist.add(decoded.jti);
    
    logger.info('Token revoked successfully', { 
      jti: decoded.jti,
      username: decoded.username 
    });
    
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to revoke token', { error: errorMessage });
    return false;
  }
}

/**
 * Check if a token is blacklisted
 * 
 * @param token Token to check
 * @returns True if blacklisted
 */
function isTokenBlacklisted(token: string): boolean {
  try {
    // Decode the token without verification
    const decoded = jwt.decode(token) as JwtPayload;
    
    if (!decoded || !decoded.jti) {
      return false;
    }
    
    // Check if the token's JTI is in the blacklist
    return tokenBlacklist.has(decoded.jti);
  } catch {
    return false;
  }
}

/**
 * Extract token from authorization header
 * 
 * @param authHeader Authorization header value
 * @returns Extracted token or null
 */
export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) {
    return null;
  }
  
  // Check for Bearer token format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
}

export default {
  generateTokens,
  verifyToken,
  verifyRefreshToken,
  revokeToken,
  extractTokenFromHeader
}; 