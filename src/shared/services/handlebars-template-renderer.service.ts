import { Injectable, Logger } from '@nestjs/common';
import Handlebars from 'handlebars';
import {
  ITemplateRenderer,
  RenderContext,
  RenderedTemplate,
} from '../interfaces/template-renderer.interface';
import { InternalServerErrorException } from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

/**
 * Handlebars Template Renderer
 * 
 * Renders templates using Handlebars templating engine
 * Provides custom helpers for common email formatting needs
 * 
 * Following Single Responsibility Principle (SRP):
 * - Only responsible for rendering templates
 * - Template fetching is delegated to provider service
 */
@Injectable()
export class HandlebarsTemplateRendererService implements ITemplateRenderer {
  private readonly logger = new Logger(
    HandlebarsTemplateRendererService.name,
  );
  private readonly compiledCache = new Map<string, Handlebars.TemplateDelegate>();

  constructor() {
    this.registerHelpers();
    this.logger.log('Handlebars Template Renderer initialized');
  }

  /**
   * Render template with context data
   */
  async render(
    templateSource: { subject?: string; html?: string; text?: string },
    context: RenderContext,
  ): Promise<RenderedTemplate> {
    try {
      const rendered: RenderedTemplate = {};

      // Render subject
      if (templateSource.subject) {
        const compiledSubject = Handlebars.compile(templateSource.subject);
        rendered.subject = compiledSubject(context).replace(/\s+/g, ' ').trim();
      }

      // Render HTML
      if (templateSource.html) {
        const compiledHtml = Handlebars.compile(templateSource.html);
        rendered.html = compiledHtml(context);
      }

      // Render text
      if (templateSource.text) {
        const compiledText = Handlebars.compile(templateSource.text);
        rendered.text = compiledText(context);
      }

      this.logger.debug('Template rendered successfully');
      return rendered;
    } catch (error) {
      this.logger.error('Failed to render template', error);
      throw new InternalServerErrorException(
        'Failed to render email template',
        ERROR_CODES.INTERNAL_SERVER,
        undefined,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          hasSubject: !!templateSource.subject,
          hasHtml: !!templateSource.html,
          hasText: !!templateSource.text,
        },
      );
    }
  }

  /**
   * Compile template for reuse (caching)
   */
  compile(templateSource: string): Handlebars.TemplateDelegate {
    const cacheKey = this.generateCacheKey(templateSource);
    
    if (this.compiledCache.has(cacheKey)) {
      return this.compiledCache.get(cacheKey)!;
    }

    const compiled = Handlebars.compile(templateSource);
    this.compiledCache.set(cacheKey, compiled);
    
    return compiled;
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Convert to uppercase
    Handlebars.registerHelper('uppercase', (str: string) =>
      String(str || '').toUpperCase(),
    );

    // Convert to lowercase
    Handlebars.registerHelper('lowercase', (str: string) =>
      String(str || '').toLowerCase(),
    );

    // Capitalize first letter
    Handlebars.registerHelper('capitalize', (str: string) => {
      const s = String(str || '');
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    });

    // Format currency
    Handlebars.registerHelper(
      'currency',
      (amount: number, currency = 'USD') => {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency,
        }).format(amount || 0);
      },
    );

    // Format date
    Handlebars.registerHelper('formatDate', (date: Date | string) => {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    });

    // Conditional equal
    Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

    // Conditional not equal
    Handlebars.registerHelper('neq', (a: unknown, b: unknown) => a !== b);

    // Greater than
    Handlebars.registerHelper('gt', (a: number, b: number) => a > b);

    // Less than
    Handlebars.registerHelper('lt', (a: number, b: number) => a < b);

    // Or condition
    Handlebars.registerHelper('or', (...args: unknown[]) => {
      // Last argument is Handlebars options object
      return args.slice(0, -1).some((arg) => !!arg);
    });

    // And condition
    Handlebars.registerHelper('and', (...args: unknown[]) => {
      // Last argument is Handlebars options object
      return args.slice(0, -1).every((arg) => !!arg);
    });

    // Default value if empty
    Handlebars.registerHelper(
      'default',
      (value: unknown, defaultValue: unknown) => value || defaultValue,
    );

    // Truncate text
    Handlebars.registerHelper(
      'truncate',
      (str: string, length: number, suffix = '...') => {
        const s = String(str || '');
        if (s.length <= length) return s;
        return s.substring(0, length) + suffix;
      },
    );

    this.logger.log('Handlebars helpers registered');
  }

  /**
   * Generate cache key from template source
   */
  private generateCacheKey(source: string): string {
    // Simple hash for caching (not cryptographic)
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
      const char = source.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `tpl_${hash}`;
  }

  /**
   * Clear compiled template cache
   */
  clearCache(): void {
    this.compiledCache.clear();
    this.logger.log('Compiled template cache cleared');
  }
}
