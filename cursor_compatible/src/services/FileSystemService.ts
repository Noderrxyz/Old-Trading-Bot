import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';

/**
 * Service for interacting with the file system
 * Provides abstraction for reading and writing files
 * with error handling and directory creation
 */
export class FileSystemService {
  /**
   * Read a file from the file system
   * @param filePath - Path to the file to read
   * @returns File contents as string or null if not found
   */
  public async readFile(filePath: string): Promise<string | null> {
    try {
      // Ensure directory exists
      await this.ensureDirectoryExists(path.dirname(filePath));
      
      const data = await fsPromises.readFile(filePath, 'utf8');
      return data;
    } catch (error: any) {
      // If file doesn't exist, return null instead of throwing
      if (error.code === 'ENOENT') {
        return null;
      }
      
      // Log other errors but don't throw
      console.error(`Error reading file ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Write data to a file
   * @param filePath - Path to write the file to
   * @param data - Data to write to the file
   * @returns True if successful, false otherwise
   */
  public async writeFile(filePath: string, data: string): Promise<boolean> {
    try {
      // Ensure directory exists
      await this.ensureDirectoryExists(path.dirname(filePath));
      
      await fsPromises.writeFile(filePath, data, 'utf8');
      return true;
    } catch (error: any) {
      console.error(`Error writing file ${filePath}:`, error.message);
      return false;
    }
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param dirPath - Directory path to ensure exists
   */
  public async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fsPromises.access(dirPath);
    } catch (error) {
      // Directory doesn't exist, create it recursively
      await fsPromises.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Check if a file exists
   * @param filePath - Path to check
   * @returns True if file exists, false otherwise
   */
  public async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file if it exists
   * @param filePath - Path of file to delete
   * @returns True if file was deleted or didn't exist, false on error
   */
  public async deleteFile(filePath: string): Promise<boolean> {
    try {
      if (await this.fileExists(filePath)) {
        await fsPromises.unlink(filePath);
      }
      return true;
    } catch (error: any) {
      console.error(`Error deleting file ${filePath}:`, error.message);
      return false;
    }
  }
} 