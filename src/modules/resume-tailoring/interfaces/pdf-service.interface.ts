import * as puppeteer from 'puppeteer';

/**
 * PDF Generation Service Configuration Interface
 *
 * Internal configuration interface used by the consolidated PDF generation service
 * to manage different performance modes and browser settings.
 *
 * This interface supports different performance modes for various use cases:
 * - Standard mode: Reliable for all content types with default settings
 * - Optimized mode: Faster generation with performance optimizations
 */
export interface PdfServiceConfig {
  /** Page loading timeout in milliseconds */
  pageTimeout: number;

  /** PDF generation timeout in milliseconds */
  pdfTimeout: number;

  /** Browser launch arguments for Puppeteer */
  browserArgs: string[];

  /** PDF generation options passed to Puppeteer */
  pdfOptions: puppeteer.PDFOptions;

  /** Performance optimization mode */
  performanceMode: 'standard' | 'optimized';
}

/**
 * PDF Generation Options Interface
 *
 * Client-facing interface that allows callers to specify optimization
 * level and custom settings for PDF generation.
 *
 * This interface provides flexible configuration while maintaining
 * sensible defaults for common use cases.
 */
export interface PdfGenerationOptions {
  /**
   * Performance optimization mode
   *
   * @default 'standard'
   *
   * - 'standard': Default settings, reliable for all content types
   *   - Higher quality output
   *   - Longer generation time
   *   - Suitable for final documents
   *
   * - 'optimized': Faster generation with reduced quality for speed-critical scenarios
   *   - Reduced quality for faster processing
   *   - Shorter timeouts
   *   - Suitable for previews or high-volume generation
   */
  optimizationMode?: 'standard' | 'optimized';

  /**
   * Custom timeout overrides (optional)
   *
   * Allows fine-tuning of timeout values for specific use cases.
   * If not provided, defaults based on optimization mode will be used.
   */
  customTimeouts?: {
    /** Page content loading timeout in milliseconds */
    pageTimeout?: number;

    /** PDF generation timeout in milliseconds */
    pdfTimeout?: number;
  };

  /**
   * Additional PDF options (optional)
   *
   * Allows fine-tuning of PDF generation parameters.
   * These options will be merged with the default options for the selected mode.
   *
   * @see https://pptr.dev/api/puppeteer.pdfoptions
   */
  customPdfOptions?: Partial<puppeteer.PDFOptions>;
}

/**
 * Enhanced PDF Generation Result Interface
 *
 * Comprehensive result object returned by the consolidated PDF generation service.
 * Provides both the generated PDF buffer and detailed performance metadata
 * for monitoring and optimization purposes.
 */
export interface PdfServiceResult {
  /**
   * Generated PDF as a byte array
   *
   * Can be converted to base64 for API responses or written directly to disk.
   */
  buffer: Uint8Array;

  /**
   * Detailed performance and processing metadata
   *
   * Useful for monitoring, debugging, and performance optimization.
   * All timing values are in milliseconds.
   */
  metadata: {
    /** Performance mode used for generation */
    performanceMode: string;

    /** Total time from start to finish */
    totalTimeMs: number;

    /** Time spent getting/creating browser instance */
    browserTimeMs: number;

    /** Time spent setting up the page (viewport, settings, etc.) */
    pageSetupTimeMs: number;

    /** Time spent loading HTML content into the page */
    contentLoadTimeMs: number;

    /** Time spent generating the actual PDF */
    pdfGenerationTimeMs: number;

    /** Time spent closing the page */
    pageCloseTimeMs: number;
  };
}

/**
 * PDF Generation Service Statistics Interface
 *
 * Provides health and operational statistics for the PDF generation service.
 * Useful for monitoring, debugging, and service health checks.
 */
export interface PdfServiceStats {
  /** Whether a browser instance exists */
  browserConnected: boolean;

  /** Whether the browser instance is active and connected */
  browserActive: boolean;

  /** List of available optimization modes */
  availableModes: string[];

  /** Current configuration for each mode */
  currentConfig: {
    standard: Partial<PdfServiceConfig>;
    optimized: Partial<PdfServiceConfig>;
  };
}
