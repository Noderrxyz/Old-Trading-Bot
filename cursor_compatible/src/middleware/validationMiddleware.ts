/**
 * Validation Middleware
 * 
 * Provides request validation using Ajv (JSON Schema validator)
 * to ensure input data meets requirements before processing.
 */
import { Request, Response, NextFunction } from 'express';
import Ajv, { JSONSchemaType } from 'ajv';
import addFormats from 'ajv-formats';
import { createComponentLogger } from '../utils/logger';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const logger = createComponentLogger('ValidationMiddleware');

/**
 * Validate request body against a JSON schema
 * 
 * @param schema JSON schema to validate against
 * @returns Middleware function
 */
export function validateBody<T>(schema: JSONSchemaType<T>) {
  const validate = ajv.compile(schema);
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const valid = validate(req.body);
    
    if (!valid) {
      const errors = validate.errors || [];
      logger.warn('Request validation failed', {
        path: req.path,
        method: req.method,
        errors: errors.map(e => ({
          field: e.instancePath || 'request',
          message: e.message,
          keyword: e.keyword
        }))
      });
      
      // Return validation errors
      res.status(400).json({
        error: 'Validation failed',
        details: errors.map(e => ({
          field: e.instancePath || 'request',
          message: e.message
        }))
      });
      return;
    }
    
    next();
  };
}

/**
 * Validate request query parameters against a JSON schema
 * 
 * @param schema JSON schema to validate against
 * @returns Middleware function
 */
export function validateQuery<T>(schema: JSONSchemaType<T>) {
  const validate = ajv.compile(schema);
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const valid = validate(req.query);
    
    if (!valid) {
      const errors = validate.errors || [];
      logger.warn('Query validation failed', {
        path: req.path,
        method: req.method,
        errors: errors.map(e => ({
          field: e.instancePath || 'query',
          message: e.message,
          keyword: e.keyword
        }))
      });
      
      // Return validation errors
      res.status(400).json({
        error: 'Query validation failed',
        details: errors.map(e => ({
          field: e.instancePath || 'query',
          message: e.message
        }))
      });
      return;
    }
    
    next();
  };
}

/**
 * Validate request parameters against a JSON schema
 * 
 * @param schema JSON schema to validate against
 * @returns Middleware function
 */
export function validateParams<T>(schema: JSONSchemaType<T>) {
  const validate = ajv.compile(schema);
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const valid = validate(req.params);
    
    if (!valid) {
      const errors = validate.errors || [];
      logger.warn('Parameters validation failed', {
        path: req.path,
        method: req.method,
        errors: errors.map(e => ({
          field: e.instancePath || 'params',
          message: e.message,
          keyword: e.keyword
        }))
      });
      
      // Return validation errors
      res.status(400).json({
        error: 'Parameters validation failed',
        details: errors.map(e => ({
          field: e.instancePath || 'params',
          message: e.message
        }))
      });
      return;
    }
    
    next();
  };
}

/**
 * Example JSON schemas for common validation needs
 */

/**
 * UUID parameter schema
 */
export const uuidParamSchema: JSONSchemaType<{ id: string }> = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' }
  },
  required: ['id'],
  additionalProperties: false
};

/**
 * Pagination query schema
 */
export const paginationQuerySchema: JSONSchemaType<{ page?: number, limit?: number }> = {
  type: 'object',
  properties: {
    page: { type: 'number', nullable: true, minimum: 1 },
    limit: { type: 'number', nullable: true, minimum: 1, maximum: 100 }
  },
  additionalProperties: true
};

/**
 * Login request schema
 */
export const loginSchema: JSONSchemaType<{ username: string, password: string }> = {
  type: 'object',
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 30 },
    password: { type: 'string', minLength: 6 }
  },
  required: ['username', 'password'],
  additionalProperties: false
};

/**
 * API Key creation schema
 */
export const apiKeyCreateSchema: JSONSchemaType<{ 
  name: string, 
  permissions?: string[],
  expiresInDays?: number 
}> = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 50 },
    permissions: { 
      type: 'array', 
      items: { type: 'string' },
      nullable: true 
    },
    expiresInDays: { 
      type: 'number',
      nullable: true,
      minimum: 1,
      maximum: 365
    }
  },
  required: ['name'],
  additionalProperties: false
};

export default {
  validateBody,
  validateQuery,
  validateParams,
  schemas: {
    uuidParamSchema,
    paginationQuerySchema,
    loginSchema,
    apiKeyCreateSchema
  }
}; 