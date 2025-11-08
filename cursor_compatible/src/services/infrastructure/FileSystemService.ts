/**
 * File System Service
 * 
 * Provides an abstraction over file system operations for consistent
 * file access across different environments.
 */

import fs from 'fs/promises';
import { Stats } from 'fs';
import path from 'path';
import logger from '../../utils/logger.js';

/**
 * Configuration for the file system service
 */
export interface FileSystemServiceConfig {
  /** Base directory for relative paths */
  baseDir: string;
  
  /** Whether to create directories if they don't exist */
  createDirs: boolean;
  
  /** File encoding to use */
  encoding: BufferEncoding;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: FileSystemServiceConfig = {
  baseDir: process.cwd(),
  createDirs: true,
  encoding: 'utf8'
};

/**
 * File system service for file operations
 */
export class FileSystemService {
  private config: FileSystemServiceConfig;
  
  /**
   * Create a new FileSystemService
   * 
   * @param config Configuration options
   */
  constructor(config: Partial<FileSystemServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Resolve a path, respecting the base directory setting
   * 
   * @param filePath Path to resolve
   * @returns Resolved absolute path
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    
    return path.resolve(this.config.baseDir, filePath);
  }
  
  /**
   * Ensure a directory exists, creating it if necessary
   * 
   * @param dirPath Directory path
   */
  private async ensureDir(dirPath: string): Promise<void> {
    if (this.config.createDirs) {
      try {
        await fs.mkdir(dirPath, { recursive: true });
      } catch (error: any) {
        // Ignore error if directory already exists
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }
  
  /**
   * Check if a file or directory exists
   * 
   * @param filePath Path to check
   * @returns Whether the file or directory exists
   */
  public async exists(filePath: string): Promise<boolean> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      await fs.access(resolvedPath);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Read a file
   * 
   * @param filePath Path to read
   * @param encoding Optional encoding override
   * @returns File contents
   */
  public async readFile(
    filePath: string,
    encoding?: BufferEncoding
  ): Promise<string> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      return await fs.readFile(
        resolvedPath,
        { encoding: encoding || this.config.encoding }
      );
    } catch (error: any) {
      logger.error(`Error reading file ${filePath}:`, error);
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }
  
  /**
   * Write to a file
   * 
   * @param filePath Path to write to
   * @param data Data to write
   * @param encoding Optional encoding override
   */
  public async writeFile(
    filePath: string,
    data: string,
    encoding?: BufferEncoding
  ): Promise<void> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      
      // Ensure directory exists
      const dirPath = path.dirname(resolvedPath);
      await this.ensureDir(dirPath);
      
      // Write file
      await fs.writeFile(
        resolvedPath,
        data,
        { encoding: encoding || this.config.encoding }
      );
    } catch (error: any) {
      logger.error(`Error writing file ${filePath}:`, error);
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }
  
  /**
   * Delete a file
   * 
   * @param filePath Path to delete
   */
  public async deleteFile(filePath: string): Promise<void> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      await fs.unlink(resolvedPath);
    } catch (error: any) {
      // Ignore if file doesn't exist
      if (error.code !== 'ENOENT') {
        logger.error(`Error deleting file ${filePath}:`, error);
        throw new Error(`Failed to delete file ${filePath}: ${error.message}`);
      }
    }
  }
  
  /**
   * List files in a directory
   * 
   * @param dirPath Directory to list
   * @returns Array of file names
   */
  public async listFiles(dirPath: string): Promise<string[]> {
    try {
      const resolvedPath = this.resolvePath(dirPath);
      return await fs.readdir(resolvedPath);
    } catch (error: any) {
      logger.error(`Error listing directory ${dirPath}:`, error);
      throw new Error(`Failed to list directory ${dirPath}: ${error.message}`);
    }
  }
  
  /**
   * Get file stats
   * 
   * @param filePath Path to get stats for
   * @returns File stats
   */
  public async getStats(filePath: string): Promise<Stats> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      return await fs.stat(resolvedPath);
    } catch (error: any) {
      logger.error(`Error getting stats for ${filePath}:`, error);
      throw new Error(`Failed to get stats for ${filePath}: ${error.message}`);
    }
  }
} 