import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { ConfigService } from '@nestjs/config';
import {
  PdfServiceConfig,
  PdfGenerationOptions,
  PdfServiceResult,
  PdfServiceStats,
} from '../interfaces/pdf-service.interface';

/**
 * Consolidated PDF Generation Service
 *
 * This service combines the functionality of both GeneratePdfService and
 * GenerateOptimizedPdfService into a single, configurable service that follows
 * SOLID principles and clean code practices.
 *
 * Key Features:
 * - Configurable optimization modes (standard/optimized)
 * - Comprehensive performance monitoring
 * - Robust error handling with detailed context
 * - Resource management with proper cleanup
 * - Browser instance reuse for better performance
 * - Extensive logging for debugging and monitoring
 *
 * Design Principles Applied:
 * - Single Responsibility: Handles PDF generation only
 * - Open/Closed: Extensible through configuration options
 * - Liskov Substitution: Can replace both original services
 * - Interface Segregation: Clean, focused interfaces
 * - Dependency Inversion: Depends on abstractions (ConfigService)
 *
 * Performance Optimizations:
 * - Persistent browser instance with connection pooling
 * - Configurable timeouts based on use case
 * - Optimized browser flags for faster rendering
 * - Detailed timing metrics for performance analysis
 */
@Injectable()
export class PdfGenerationService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfGenerationService.name);
  private browser: puppeteer.Browser | null = null;
  private browserPromise: Promise<puppeteer.Browser> | null = null;
  private readonly performanceConfigs: Record<string, PdfServiceConfig>;

  constructor(private readonly configService: ConfigService) {
    // Initialize performance configurations
    this.performanceConfigs = {
      standard: this.createStandardConfig(),
      optimized: this.createOptimizedConfig(),
    };

    this.logger.log(
      'PDF Generation Service initialized with dual performance modes',
    );
  }

  /**
   * Generate PDF from HTML content with configurable optimization
   *
   * @param html - HTML content to convert to PDF
   * @param options - Generation options including optimization mode
   * @returns Promise<PdfGenerationResult> - Generated PDF with metadata
   */
  async generatePdfFromHtml(
    html: string,
    options: PdfGenerationOptions = {},
  ): Promise<PdfServiceResult> {
    const overallStartTime = Date.now();
    const performanceMode = options.optimizationMode || 'standard';
    const config = this.getEffectiveConfig(performanceMode, options);

    let page: puppeteer.Page | null = null;
    const timingMetrics = {
      browserTimeMs: 0,
      pageSetupTimeMs: 0,
      contentLoadTimeMs: 0,
      pdfGenerationTimeMs: 0,
      pageCloseTimeMs: 0,
    };

    try {
      this.logger.log(`Starting PDF generation in ${performanceMode} mode`);

      // Get browser instance
      const browserStartTime = Date.now();
      const browser = await this.getBrowser();
      timingMetrics.browserTimeMs = Date.now() - browserStartTime;

      // Create and setup page
      const pageSetupStartTime = Date.now();
      page = await browser.newPage();
      await this.setupPage(page, config);
      timingMetrics.pageSetupTimeMs = Date.now() - pageSetupStartTime;

      // Load content
      const contentStartTime = Date.now();
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: config.pageTimeout,
      });
      timingMetrics.contentLoadTimeMs = Date.now() - contentStartTime;

      // Generate PDF
      this.logger.debug('Generating PDF buffer');
      const pdfStartTime = Date.now();
      const pdfBuffer = await page.pdf({
        ...config.pdfOptions,
        timeout: config.pdfTimeout,
      });
      timingMetrics.pdfGenerationTimeMs = Date.now() - pdfStartTime;

      const totalTime = Date.now() - overallStartTime;

      this.logger.log(
        `PDF generated successfully in ${totalTime}ms using ${performanceMode} mode ` +
          `(browser: ${timingMetrics.browserTimeMs}ms, setup: ${timingMetrics.pageSetupTimeMs}ms, ` +
          `content: ${timingMetrics.contentLoadTimeMs}ms, pdf: ${timingMetrics.pdfGenerationTimeMs}ms)`,
      );

      return {
        buffer: pdfBuffer,
        metadata: {
          performanceMode,
          totalTimeMs: totalTime,
          ...timingMetrics,
        },
      };
    } catch (error) {
      const totalTime = Date.now() - overallStartTime;
      this.handleGenerationError(
        error,
        performanceMode,
        totalTime,
        timingMetrics,
      );
      throw error; // Re-throw after logging
    } finally {
      if (page) {
        const closeStartTime = Date.now();
        await page.close().catch((closeError) => {
          this.logger.warn('Failed to close page gracefully', closeError);
        });
        timingMetrics.pageCloseTimeMs = Date.now() - closeStartTime;
      }
    }
  }

  /**
   * Get service health and statistics
   * Useful for monitoring and debugging
   */
  getServiceStats(): PdfServiceStats {
    return {
      browserConnected: !!this.browser,
      browserActive: this.browser?.isConnected() || false,
      availableModes: Object.keys(this.performanceConfigs),
      currentConfig: {
        standard: {
          performanceMode: this.performanceConfigs.standard.performanceMode,
          pageTimeout: this.performanceConfigs.standard.pageTimeout,
          pdfTimeout: this.performanceConfigs.standard.pdfTimeout,
        },
        optimized: {
          performanceMode: this.performanceConfigs.optimized.performanceMode,
          pageTimeout: this.performanceConfigs.optimized.pageTimeout,
          pdfTimeout: this.performanceConfigs.optimized.pdfTimeout,
        },
      },
    };
  }

  /**
   * Force browser restart (useful for memory management)
   */
  async restartBrowser(): Promise<void> {
    const restartStartTime = Date.now();

    if (this.browser) {
      await this.browser.close().catch((error) => {
        this.logger.warn('Error closing browser during restart', error);
      });
      this.browser = null;
      this.browserPromise = null;
    }

    // Pre-warm the browser
    await this.getBrowser();

    const restartTime = Date.now() - restartStartTime;
    this.logger.log(`Browser restarted in ${restartTime}ms`);
  }

  /**
   * Clean shutdown on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    const destroyStartTime = Date.now();

    if (this.browser) {
      try {
        await this.browser.close();
        const destroyTime = Date.now() - destroyStartTime;
        this.logger.log(
          `Browser closed gracefully on module destroy in ${destroyTime}ms`,
        );
      } catch (error) {
        this.logger.error('Error closing browser on module destroy', error);
      }
    }
  }

  // ===== PRIVATE METHODS =====

  /**
   * Get or create browser instance with connection pooling
   */
  private async getBrowser(): Promise<puppeteer.Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    if (this.browserPromise !== null) {
      return this.browserPromise;
    }

    this.browserPromise = this.launchBrowser();
    try {
      this.browser = await this.browserPromise;
      return this.browser;
    } finally {
      this.browserPromise = null;
    }
  }

  /**
   * Launch browser with optimized settings
   */
  private async launchBrowser(): Promise<puppeteer.Browser> {
    const launchStartTime = Date.now();
    this.logger.debug('Launching PDF generation browser instance');

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-plugins',
      ],
    });

    const launchTime = Date.now() - launchStartTime;
    this.logger.debug(`Browser launched successfully in ${launchTime}ms`);

    return browser;
  }

  /**
   * Setup page with performance optimizations
   */
  private async setupPage(
    page: puppeteer.Page,
    config: PdfServiceConfig,
  ): Promise<void> {
    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 800,
      deviceScaleFactor: config.performanceMode === 'optimized' ? 1 : 2,
    });

    // Apply performance optimizations for optimized mode
    if (config.performanceMode === 'optimized') {
      await page.setJavaScriptEnabled(false);
      await page.setCacheEnabled(false);
    }
  }

  /**
   * Create standard performance configuration
   */
  private createStandardConfig(): PdfServiceConfig {
    return {
      performanceMode: 'standard',
      pageTimeout: this.configService.get<number>(
        'performance.pdfPageTimeout',
        10000,
      ),
      pdfTimeout: this.configService.get<number>(
        'performance.pdfTimeout',
        15000,
      ),
      browserArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
      pdfOptions: {
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm',
        },
        omitBackground: false,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
      },
    };
  }

  /**
   * Create optimized performance configuration
   */
  private createOptimizedConfig(): PdfServiceConfig {
    const baseConfig = this.createStandardConfig();

    return {
      ...baseConfig,
      performanceMode: 'optimized',
      pageTimeout: this.configService.get<number>(
        'performance.pdfPageTimeout',
        8000,
      ),
      pdfTimeout: this.configService.get<number>(
        'performance.pdfTimeout',
        10000,
      ),
      browserArgs: [
        ...baseConfig.browserArgs,
        '--disable-images',
        '--disable-javascript',
      ],
      pdfOptions: {
        ...baseConfig.pdfOptions,
        tagged: false,
        outline: false,
      },
    };
  }

  /**
   * Get effective configuration with custom overrides
   */
  private getEffectiveConfig(
    performanceMode: 'standard' | 'optimized',
    options: PdfGenerationOptions,
  ): PdfServiceConfig {
    const baseConfig = this.performanceConfigs[performanceMode];

    return {
      ...baseConfig,
      pageTimeout:
        options.customTimeouts?.pageTimeout || baseConfig.pageTimeout,
      pdfTimeout: options.customTimeouts?.pdfTimeout || baseConfig.pdfTimeout,
      pdfOptions: {
        ...baseConfig.pdfOptions,
        ...options.customPdfOptions,
      },
    };
  }

  /**
   * Handle PDF generation errors with comprehensive logging
   */
  private handleGenerationError(
    error: unknown,
    performanceMode: string,
    totalTime: number,
    timingMetrics: Record<string, number>,
  ): void {
    const errorContext = {
      performanceMode,
      totalTimeMs: totalTime,
      timingBreakdown: timingMetrics,
      browserConnected: this.browser?.isConnected() || false,
    };

    if (error instanceof Error) {
      this.logger.error(
        `PDF generation failed after ${totalTime}ms in ${performanceMode} mode: ${error.message}`,
        { ...errorContext, stack: error.stack },
      );

      // Enhanced error classification
      if (error.message.includes('timeout')) {
        throw new Error(
          `PDF generation timeout in ${performanceMode} mode after ${totalTime}ms: ${error.message}`,
        );
      }

      if (error.message.includes('navigation')) {
        throw new Error(
          `PDF navigation error in ${performanceMode} mode: ${error.message}`,
        );
      }

      throw new Error(
        `PDF generation failed in ${performanceMode} mode after ${totalTime}ms: ${error.message}`,
      );
    }

    this.logger.error(
      `PDF generation failed with unknown error after ${totalTime}ms in ${performanceMode} mode`,
      errorContext,
    );

    throw new Error(
      `PDF generation failed in ${performanceMode} mode after ${totalTime}ms: Unknown error`,
    );
  }
}
