import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITemplateProvider,
  TemplateFetchParams,
  TemplateContent,
} from '../interfaces/template-provider.interface';
import { S3Service } from '../modules/external/services/s3.service';
import {
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

/**
 * S3 Template Provider
 * 
 * Fetches email templates from S3 bucket
 * Implements caching for performance optimization
 * 
 * Following Single Responsibility Principle (SRP):
 * - Only responsible for fetching templates from S3
 * - Rendering is delegated to separate renderer service
 */
@Injectable()
export class S3TemplateProviderService implements ITemplateProvider {
  private readonly logger = new Logger(S3TemplateProviderService.name);
  private readonly cache = new Map<string,{ content: string; timestamp: number }>();
  private readonly defaultBucket: string;
  private readonly defaultCacheTtl: number;

  constructor(
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService,
  ) {
    this.defaultBucket =
      this.configService.get<string>('AWS_S3_EMAIL_TEMPLATES_BUCKET') ||
      'ats-fit-email-templates';
    this.defaultCacheTtl =
      this.configService.get<number>('TEMPLATE_CACHE_TTL') || 600000; // 10 minutes

    this.logger.log(
      `S3 Template Provider initialized with bucket: ${this.defaultBucket}`,
    );
  }

  /**
   * Fetch template from S3
   * Supports multiple file formats: .hbs, .html, .txt
   * Structure: email-templates/{templateKey}/subject.hbs, html.hbs, text.hbs
   * OR: email-templates/{templateKey}.hbs (single file)
   */
  async fetchTemplate(params: TemplateFetchParams): Promise<string> {
    const { templateKey, bucketName, cacheTtl } = params;
    const bucket = bucketName || this.defaultBucket;
    const ttl = cacheTtl || this.defaultCacheTtl;
    const cacheKey = `${bucket}:${templateKey}`;

    if (!templateKey) {
      throw new BadRequestException(
        'Template key is required',
        ERROR_CODES.INVALID_TEMPLATE_KEY,
      );
    }

    // Check cache first
    const cached = this.getCachedTemplate(cacheKey, ttl);
    if (cached) {
      this.logger.debug(`Cache hit for template: ${templateKey}`);
      return cached;
    }

    this.logger.log(`Fetching template from S3: ${templateKey}`);

    try {
      // Try structured approach first (folder with multiple files)
      const content = await this.fetchSingleFileTemplate(bucket, templateKey);

      if (!content) {
        this.logger.log(
            `fetchSingleFileTemplate -> S3 Template content not found in bucket: ${this.defaultBucket} and templateKey: ${templateKey}`,
        );
        throw new NotFoundException(
          'Email template not found',
          ERROR_CODES.TEMPLATE_NOT_FOUND,
        );
      }
      
      // Cache the result
      this.cache.set(cacheKey, {
        content,
        timestamp: Date.now(),
      });

      return content;
    } catch (error) {
      // Fallback: try single file approach
    }
  }

  /**
   * Fetch structured template (folder with subject.hbs, html.hbs, text.hbs)
   */
  private async fetchStructuredTemplate(
    bucket: string,
    templateKey: string,
  ): Promise<TemplateContent> {
    const baseKey = `email-templates/${templateKey}`;
    const content: TemplateContent = {};

    // Try to fetch each file
    const filePromises = [
      this.fetchTemplateFile(bucket, `${baseKey}/subject.hbs`).then(
        (data) => (content.subject = data),
      ),
      this.fetchTemplateFile(bucket, `${baseKey}/html.hbs`).then(
        (data) => (content.html = data),
      ),
      this.fetchTemplateFile(bucket, `${baseKey}/text.hbs`).then(
        (data) => (content.text = data),
      ),
    ];

    // Wait for all files (ignore errors for optional files)
    await Promise.allSettled(filePromises);

    // At least one file should exist
    if (!content.subject && !content.html && !content.text) {
      throw new Error('No template files found');
    }

    return content;
  }

  /**
   * Fetch single file template (email-templates/{templateKey}.hbs)
   */
  private async fetchSingleFileTemplate(
    bucket: string,
    templateKey: string,
  ): Promise<string> {
    const key = `email-templates/${templateKey}.hbs`;
    return  await this.fetchTemplateFile(bucket, key);
  }

  /**
   * Fetch individual template file from S3
   */
  private async fetchTemplateFile(
    bucket: string,
    key: string,
  ): Promise<string> {
    try {
      const buffer = await this.s3Service.getObject({
        bucketName: bucket,
        key,
      });
      return buffer.toString('utf-8');
    } catch (error) {
      this.logger.debug(`Template file not found: ${key}`);
      throw error;
    }
  }

  /**
   * Check if template exists in S3
   */
  async templateExists(params: TemplateFetchParams): Promise<boolean> {
    const { templateKey, bucketName } = params;
    const bucket = bucketName || this.defaultBucket;

    try {
      // Try structured approach
      const baseKey = `email-templates/${templateKey}`;
      const htmlExists = await this.s3Service.objectExists({
        bucketName: bucket,
        key: `${baseKey}/html.hbs`,
      });

      if (htmlExists) return true;

      // Try single file approach
      const singleFileExists = await this.s3Service.objectExists({
        bucketName: bucket,
        key: `email-templates/${templateKey}.hbs`,
      });

      return singleFileExists;
    } catch (error) {
      this.logger.error(
        `Error checking template existence: ${templateKey}`,
        error,
      );
      return false;
    }
  }

  /**
   * Get cached template if valid
   */
  private getCachedTemplate(
    cacheKey: string,
    ttl: number,
  ): string | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > ttl) {
      this.cache.delete(cacheKey);
      return null;
    }

    return cached.content;
  }

  /**
   * Invalidate cached template
   */
  invalidateCache(templateKey: string): void {
    const bucket = this.defaultBucket;
    const cacheKey = `${bucket}:${templateKey}`;
    this.cache.delete(cacheKey);
    this.logger.log(`Cache invalidated for template: ${templateKey}`);
  }

  /**
   * Clear all cached templates
   */
  clearAllCache(): void {
    this.cache.clear();
    this.logger.log('All template cache cleared');
  }
}
