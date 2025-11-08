/**
 * Authentication Routes
 * 
 * Provides endpoints for:
 * - User login
 * - User logout
 * - Token refresh
 * - API key management
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import tokenService from './tokenService';
import apiKeyManager from './apiKeyManager';
import { authenticate, authorize } from './authMiddleware';
import { Permission, UserRole } from './types';
import { createComponentLogger } from '../utils/logger';

const router = Router();
const logger = createComponentLogger('AuthRoutes');

// Mock user database - would be replaced with actual database in production
const users = [
  {
    id: '1',
    username: 'admin',
    password: 'admin123', // Would be hashed in production
    email: 'admin@noderr.com',
    roles: [UserRole.ADMIN],
    permissions: [], // Admin has all permissions by default
    isActive: true,
    createdAt: new Date(),
    mfaEnabled: false
  },
  {
    id: '2',
    username: 'trader',
    password: 'trader123', // Would be hashed in production
    email: 'trader@noderr.com',
    roles: [UserRole.TRADER],
    permissions: [
      Permission.TRADE_READ,
      Permission.TRADE_EXECUTE,
      Permission.TRADE_MODIFY,
      Permission.TRADE_CANCEL,
      Permission.STRATEGY_READ
    ],
    isActive: true,
    createdAt: new Date(),
    mfaEnabled: false
  }
];

/**
 * @route POST /auth/login
 * @description Authenticate user and return JWT tokens
 * @access Public
 */
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  // Find user by username (in production, use a database)
  const user = users.find(u => u.username === username);
  
  // Check if user exists and password is correct
  // In production, would use bcrypt to compare hashed passwords
  if (!user || user.password !== password) {
    logger.debug('Login failed: Invalid credentials', { username });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Check if user is active
  if (!user.isActive) {
    logger.warn('Login failed: User account inactive', { userId: user.id, username });
    return res.status(403).json({ error: 'Account is inactive' });
  }
  
  // Generate tokens
  const tokenResponse = tokenService.generateTokens(
    user.id,
    user.username,
    user.roles,
    user.permissions,
    { includeRefreshToken: true }
  );
  
  // Log successful login
  logger.info('User logged in successfully', {
    userId: user.id,
    username: user.username,
    roles: user.roles
  });
  
  // Return tokens
  return res.status(200).json({
    userId: user.id,
    username: user.username,
    roles: user.roles,
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
    expiresAt: tokenResponse.expiresAt.toISOString()
  });
});

/**
 * @route POST /auth/refresh
 * @description Refresh access token using refresh token
 * @access Public
 */
router.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }
  
  // Verify refresh token
  const result = tokenService.verifyRefreshToken(refreshToken);
  
  if (!result.valid || !result.payload) {
    logger.debug('Token refresh failed: Invalid refresh token', { error: result.error });
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  
  // Get user ID from token payload
  const userId = result.payload.sub;
  
  // Find user by ID (in production, use a database)
  const user = users.find(u => u.id === userId);
  
  if (!user || !user.isActive) {
    logger.warn('Token refresh failed: User not found or inactive', { userId });
    return res.status(403).json({ error: 'User not found or inactive' });
  }
  
  // Generate new tokens
  const tokenResponse = tokenService.generateTokens(
    user.id,
    user.username,
    user.roles,
    user.permissions,
    { includeRefreshToken: true }
  );
  
  // Revoke the old refresh token (best practice)
  tokenService.revokeToken(refreshToken);
  
  // Log token refresh
  logger.info('Access token refreshed', { userId, username: user.username });
  
  // Return new tokens
  return res.status(200).json({
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
    expiresAt: tokenResponse.expiresAt.toISOString()
  });
});

/**
 * @route POST /auth/logout
 * @description Logout user by revoking tokens
 * @access Protected
 */
router.post('/logout', authenticate, (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const authHeader = req.headers.authorization;
  const accessToken = tokenService.extractTokenFromHeader(authHeader);
  
  // Revoke access token
  if (accessToken) {
    tokenService.revokeToken(accessToken);
  }
  
  // Revoke refresh token if provided
  if (refreshToken) {
    tokenService.revokeToken(refreshToken);
  }
  
  logger.info('User logged out', { userId: req.user?.sub, username: req.user?.username });
  
  return res.status(200).json({ message: 'Logout successful' });
});

/**
 * @route GET /auth/me
 * @description Get current user information
 * @access Protected
 */
router.get('/me', authenticate, (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Find user by ID (in production, use a database)
  const user = users.find(u => u.id === req.user?.sub);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Return user info (excluding sensitive data)
  return res.status(200).json({
    id: user.id,
    username: user.username,
    email: user.email,
    roles: user.roles,
    permissions: user.permissions,
    mfaEnabled: user.mfaEnabled
  });
});

// API Key Management Routes

/**
 * @route POST /auth/apikeys
 * @description Create a new API key
 * @access Protected
 */
router.post('/apikeys', authenticate, authorize(Permission.API_KEY_CREATE), (req: Request, res: Response) => {
  const { name, permissions, expiresInDays } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'API key name is required' });
  }
  
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Generate API key
  const result = apiKeyManager.generateApiKey(
    req.user.sub,
    name,
    permissions || [], // Default to no permissions
    expiresInDays
  );
  
  logger.info('API key created', {
    userId: req.user.sub,
    keyId: result.apiKey.id,
    keyName: name
  });
  
  // Return API key (this is the only time the actual key will be shown)
  return res.status(201).json({
    apiKey: result.apiKey,
    actualKey: result.actualKey,
    message: 'Store this API key securely. It will not be shown again.'
  });
});

/**
 * @route GET /auth/apikeys
 * @description List user's API keys
 * @access Protected
 */
router.get('/apikeys', authenticate, authorize(Permission.API_KEY_READ), (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Get API keys for user
  const keys = apiKeyManager.listApiKeys(req.user.sub);
  
  // Return list (without actual keys)
  return res.status(200).json({
    apiKeys: keys
  });
});

/**
 * @route DELETE /auth/apikeys/:keyId
 * @description Revoke an API key
 * @access Protected
 */
router.delete('/apikeys/:keyId', authenticate, authorize(Permission.API_KEY_REVOKE), (req: Request, res: Response) => {
  const { keyId } = req.params;
  
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Get the API key
  const apiKey = apiKeyManager.getApiKey(keyId);
  
  // Check if key exists and belongs to user
  if (!apiKey) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  if (apiKey.userId !== req.user.sub && !req.user.roles.includes(UserRole.ADMIN)) {
    logger.warn('Unauthorized API key revocation attempt', {
      userId: req.user.sub,
      keyId,
      keyOwner: apiKey.userId
    });
    return res.status(403).json({ error: 'Not authorized to revoke this API key' });
  }
  
  // Revoke the key
  const success = apiKeyManager.revokeApiKey(keyId);
  
  if (!success) {
    return res.status(500).json({ error: 'Failed to revoke API key' });
  }
  
  logger.info('API key revoked', {
    userId: req.user.sub,
    keyId,
    keyName: apiKey.name
  });
  
  return res.status(200).json({
    message: 'API key revoked successfully'
  });
});

export default router; 