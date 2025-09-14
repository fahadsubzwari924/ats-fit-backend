import * as crypto from 'crypto';

/**
 * File utility functions following Single Responsibility Principle
 */
export class FileUtil {
  /**
   * Generate SHA256 hash for file deduplication
   */
  static generateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Convert buffer to base64 string for JSON storage
   */
  static bufferToBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  /**
   * Convert base64 string back to buffer
   */
  static base64ToBuffer(base64String: string): Buffer {
    return Buffer.from(base64String, 'base64');
  }

  /**
   * Get human-readable file size
   */
  static formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  }
}
