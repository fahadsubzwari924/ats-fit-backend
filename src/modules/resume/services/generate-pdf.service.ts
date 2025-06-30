// pdf.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GeneratePdfService implements OnModuleDestroy {
  private readonly logger = new Logger(GeneratePdfService.name);
  private browser: puppeteer.Browser | null = null;
  private browserPromise: Promise<puppeteer.Browser> | null = null;

  constructor(private configService: ConfigService) {}

  private async getBrowser(): Promise<puppeteer.Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = this.launchBrowser();
    this.browser = await this.browserPromise;
    this.browserPromise = null;
    return this.browser;
  }

  private async launchBrowser(): Promise<puppeteer.Browser> {
    this.logger.log('Launching PDF generation browser instance');
    return await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    });
  }

  async generatePdfFromHtml(html: string): Promise<Uint8Array> {
    let page: puppeteer.Page | null = null;

    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Get performance configuration
      const pdfPageTimeout = this.configService.get<number>('performance.pdfPageTimeout', 10000);
      const pdfTimeout = this.configService.get<number>('performance.pdfTimeout', 15000);

      // Optimize page settings for faster rendering
      await page.setViewport({ width: 1200, height: 800 });
      await page.setContent(html, {
        waitUntil: 'domcontentloaded', // Changed from networkidle0 for faster loading
        timeout: pdfPageTimeout,
      });

      this.logger.log('Generating PDF buffer');
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm',
        },
        timeout: pdfTimeout,
        omitBackground: false,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
      });

      return pdfBuffer;
    } catch (error) {
      this.logger.error('Failed to generate PDF', error);
      throw new Error('Failed to generate PDF');
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}
