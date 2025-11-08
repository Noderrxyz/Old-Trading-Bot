/**
 * Authentication and Authorization Middleware
 * 
 * This module provides Express middleware for:
 * 1. Authentication - Verifying user identity
 * 2. Authorization - Verifying user permissions
 */
import { Request, Response, NextFunction } from 'express';
import { Permission, UserRole, JwtPayload } from './types';
import tokenService from './tokenService';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('AuthMiddleware');

// Extend Express Request type to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  const token = tokenService.extractTokenFromHeader(authHeader);
  
  if (!token) {
    logger.debug('Authentication failed: No token provided');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  
  // Verify the token
  const result = tokenService.verifyToken(token);
  
  if (!result.valid || !result.payload) {
    logger.debug('Authentication failed: Invalid token', { error: result.error });
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  
  // Attach user to request
  req.user = result.payload;
  
  // Log successful authentication
  logger.debug('User authenticated', { 
    userId: result.payload.sub,
    username: result.payload.username
  });
  
  next();
}

/**
 * Authorization middleware - checks for required permissions
 * 
 * @param requiredPermissions Permissions required to access the resource
 */
export function authorize(requiredPermissions: Permission | Permission[]) {
  const permissions = Array.isArray(requiredPermissions) 
    ? requiredPermissions 
    : [requiredPermissions];
  
  return (req: Request, res: Response, next: NextFunction): void => {
    // Must be used after authenticate middleware
    if (!req.user) {
      logger.warn('Authorization middleware used without authentication');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    
    // Check if user has admin role (full access)
    if (req.user.roles.includes(UserRole.ADMIN)) {
      next();
      return;
    }
    
    // Check for specific permissions
    const userPermissions = req.user.permissions || [];
    const hasAllPermissions = permissions.every(permission => 
      userPermissions.includes(permission)
    );
    
    if (!hasAllPermissions) {
      logger.warn('Authorization failed: Insufficient permissions', {
        userId: req.user.sub,
        username: req.user.username,
        requiredPermissions: permissions,
        userPermissions
      });
      
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    
    // User has required permissions
    next();
  };
}

/**
 * Role-based authorization middleware
 * 
 * @param requiredRoles Roles required to access the resource
 */
export function authorizeRoles(requiredRoles: UserRole | UserRole[]) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  
  return (req: Request, res: Response, next: NextFunction): void => {
    // Must be used after authenticate middleware
    if (!req.user) {
      logger.warn('Role authorization middleware used without authentication');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    
    // Check if user has any of the required roles
    const hasRequiredRole = roles.some(role => req.user!.roles.includes(role));
    
    if (!hasRequiredRole) {
      logger.warn('Role authorization failed', {
        userId: req.user.sub,
        username: req.user.username,
        requiredRoles: roles,
        userRoles: req.user.roles
      });
      
      res.status(403).json({ error: 'Insufficient role permissions' });
      return;
    }
    
    // User has required role
    next();
  };
}

/**
 * API key authentication middleware
 * Uses a custom API key header instead of JWT
 */
export function authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
  // API key would typically be in the header
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    logger.debug('API key authentication failed: No key provided');
    res.status(401).json({ error: 'API key required' });
    return;
  }
  
  // In a real implementation, we would verify the API key against a database
  // For now, just log that this would happen
  logger.debug('API key validation would happen here', { 
    apiKeyPrefix: apiKey.substring(0, 8) + '...'
  });
  
  // Mock implementation - in reality this would check the database
  // and load the appropriate permissions
  req.user = {
    sub: 'api-user',
    username: 'api',
    roles: [UserRole.TRADER],
    permissions: [
      Permission.TRADE_READ,
      Permission.TRADE_EXECUTE
    ],
    jti: 'api-key',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  
  next();
}

export default {
  authenticate,
  authorize,
  authorizeRoles,
  authenticateApiKey
}; 