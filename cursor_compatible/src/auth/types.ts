/**
 * Type definitions for the authentication and authorization system
 */

/**
 * User roles in the system following least privilege principle
 */
export enum UserRole {
  ADMIN = 'admin',           // Full system access
  TRADER = 'trader',         // Trading capabilities
  ANALYST = 'analyst',       // Read-only access to trading data
  AUDITOR = 'auditor',       // Access to logs and audit information
  OBSERVER = 'observer',     // Minimal read-only access
}

/**
 * Permission types in the system
 */
export enum Permission {
  // Trading permissions
  TRADE_READ = 'trade:read',
  TRADE_EXECUTE = 'trade:execute',
  TRADE_MODIFY = 'trade:modify',
  TRADE_CANCEL = 'trade:cancel',
  
  // Strategy permissions
  STRATEGY_READ = 'strategy:read',
  STRATEGY_CREATE = 'strategy:create',
  STRATEGY_MODIFY = 'strategy:modify',
  STRATEGY_DELETE = 'strategy:delete',
  
  // User management
  USER_READ = 'user:read',
  USER_CREATE = 'user:create',
  USER_MODIFY = 'user:modify',
  USER_DELETE = 'user:delete',
  
  // API key management
  API_KEY_READ = 'apikey:read',
  API_KEY_CREATE = 'apikey:create',
  API_KEY_REVOKE = 'apikey:revoke',
  
  // System management
  SYSTEM_CONFIG_READ = 'system:config:read',
  SYSTEM_CONFIG_MODIFY = 'system:config:modify',
  LOGS_READ = 'logs:read',
  METRICS_READ = 'metrics:read',
}

/**
 * User profile information
 */
export interface User {
  id: string;
  username: string;
  email: string;
  roles: UserRole[];
  permissions?: Permission[];
  isActive: boolean;
  createdAt: Date;
  lastLogin?: Date;
  mfaEnabled: boolean;
}

/**
 * Session information for authenticated users
 */
export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
}

/**
 * API key information
 */
export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string; // First few chars of the key for identification
  permissions: Permission[];
  expiresAt?: Date;
  createdAt: Date;
  lastUsed?: Date;
  isActive: boolean;
}

/**
 * JWT payload structure
 */
export interface JwtPayload {
  sub: string;         // User ID
  username: string;    // Username
  roles: UserRole[];   // User roles
  permissions: Permission[]; // Specific permissions
  jti: string;         // JWT ID (for revocation)
  iat: number;         // Issued at
  exp: number;         // Expiration time
  mfa?: boolean;       // Whether MFA has been completed
} 