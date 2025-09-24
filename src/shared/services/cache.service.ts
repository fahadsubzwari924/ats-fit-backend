import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum number of entries
  namespace?: string; // Cache namespace for key prefixing
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

/**
 * Centralized caching service for the application
 *
 * Features:
 * - Generic type support for type-safe caching
 * - TTL-based expiration with automatic cleanup
 * - Size-based eviction (LRU)
 * - Namespace support for logical separation
 * - Performance metrics and monitoring
 * - Hash-based key generation for consistent keys
 *
 * Usage:
 * ```typescript
 * // Basic usage
 * await cacheService.set('key', data, { ttl: 60000 }); // 1 minute
 * const data = await cacheService.get<MyType>('key');
 *
 * // With namespace
 * await cacheService.set('analysis', result, {
 *   ttl: 3600000, // 1 hour
 *   namespace: 'job-analysis'
 * });
 *
 * // Generate consistent hash keys
 * const key = cacheService.generateKey({ jobId: 123, userId: 456 });
 * ```
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly cache = new Map<string, CacheEntry<any>>();

  // Default configuration
  private readonly DEFAULT_TTL = 60 * 60 * 1000; // 1 hour
  private readonly DEFAULT_MAX_SIZE = 1000;

  // Performance metrics
  private stats = {
    hits: 0,
    misses: 0,
  };

  /**
   * Store data in cache with optional TTL and namespace
   */
  set<T>(key: string, data: T, options: CacheOptions = {}): void {
    const {
      ttl = this.DEFAULT_TTL,
      maxSize = this.DEFAULT_MAX_SIZE,
      namespace,
    } = options;

    const fullKey = this.buildKey(key, namespace);
    const now = Date.now();

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiry: now + ttl,
    };

    this.cache.set(fullKey, entry);

    // Trigger cleanup if cache is getting large
    if (this.cache.size > maxSize) {
      this.cleanup(maxSize);
    }

    this.logger.debug(`Cached data for key: ${fullKey}`);
  }

  /**
   * Retrieve data from cache
   */
  get<T>(key: string, namespace?: string): T | null {
    const fullKey = this.buildKey(key, namespace);
    const entry = this.cache.get(fullKey) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const now = Date.now();
    if (now >= entry.expiry) {
      this.cache.delete(fullKey);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.data;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string, namespace?: string): boolean {
    const data = this.get(key, namespace);
    return data !== null;
  }

  /**
   * Remove specific key from cache
   */
  delete(key: string, namespace?: string): boolean {
    const fullKey = this.buildKey(key, namespace);
    return this.cache.delete(fullKey);
  }

  /**
   * Clear all cache entries or entries in specific namespace
   */
  clear(namespace?: string): void {
    if (!namespace) {
      this.cache.clear();
      this.logger.debug('Cleared entire cache');
      return;
    }

    const prefix = `${namespace}:`;
    let deletedCount = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }

    this.logger.debug(
      `Cleared ${deletedCount} entries from namespace: ${namespace}`,
    );
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      maxSize: this.DEFAULT_MAX_SIZE,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }

  /**
   * Generate consistent hash key from object
   */
  generateKey(data: Record<string, any>): string {
    const serialized = JSON.stringify(data, Object.keys(data).sort());
    return crypto
      .createHash('sha256')
      .update(serialized)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Cache a function result with automatic key generation
   */
  async cached<T>(
    keyData: Record<string, any>,
    factory: () => Promise<T>,
    options: CacheOptions = {},
  ): Promise<T> {
    const key = this.generateKey(keyData);

    // Try to get from cache first
    const cached = this.get<T>(key, options.namespace);
    if (cached !== null) {
      return cached;
    }

    // Execute factory function and cache result
    const result = await factory();
    this.set(key, result, options);

    return result;
  }

  /**
   * Build full cache key with optional namespace
   */
  private buildKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}:${key}` : key;
  }

  /**
   * Clean expired entries and enforce size limits
   */
  private cleanup(maxSize: number): void {
    const now = Date.now();
    let removedCount = 0;

    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiry) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    // If still over limit, remove oldest entries (LRU)
    if (this.cache.size > maxSize) {
      const entries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      );

      const toRemove = entries.slice(0, entries.length - maxSize);
      toRemove.forEach(([key]) => this.cache.delete(key));
      removedCount += toRemove.length;
    }

    if (removedCount > 0) {
      this.logger.debug(`Cleaned up ${removedCount} cache entries`);
    }
  }
}
