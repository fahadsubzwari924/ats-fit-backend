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
import { AwsConfigKeys } from '../enums';

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
      this.configService.get<string>(AwsConfigKeys.AWS_S3_EMAIL_TEMPLATES_BUCKET) ||
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
        ERROR_CODES.TEMPLATE_KEY_REQUIRED,
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
      this.logger.error(
        `Failed to fetch template: ${templateKey} from bucket: ${bucket}`,
        error,
      );

      throw new InternalServerErrorException(
        'Failed to fetch email template from S3',
        ERROR_CODES.TEMPLATE_FETCH_FAILED,
        undefined,
        {
          templateKey,
          bucket,
          error,
        },
      );
    }
  }

  /**
   * Validate fetch template parameters
   */
  private validateFetchTemplateParams(bucket: string, templateKey: string): void {
    // Validate bucket
    if (!bucket || typeof bucket !== 'string') {
      throw new BadRequestException(
        'S3 bucket name is required and must be a string',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { bucket, type: typeof bucket },
      );
    }

    if (bucket.trim() === '') {
      throw new BadRequestException(
        'S3 bucket name cannot be empty',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { bucket },
      );
    }

    // Validate templateKey
    if (!templateKey || typeof templateKey !== 'string') {
      throw new BadRequestException(
        'Template key is required and must be a string',
        ERROR_CODES.INVALID_TEMPLATE_KEY,
        undefined,
        { templateKey, type: typeof templateKey },
      );
    }

    if (templateKey.trim() === '') {
      throw new BadRequestException(
        'Template key cannot be empty',
        ERROR_CODES.INVALID_TEMPLATE_KEY,
        undefined,
        { templateKey },
      );
    }

  }

  /**
   * Fetch single file template (email-templates/{templateKey}.hbs)
   */
  private async fetchSingleFileTemplate(
    bucket: string,
    templateKey: string,
  ): Promise<string> {
    // Validate parameters
    this.validateFetchTemplateParams(bucket, templateKey);

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
      this.logger.debug(`Template buffer: ${buffer}`);
      return buffer.toString('utf-8');
    } catch (error) {
      this.logger.debug(`Template file not found: ${key}`);
      throw error;
    }
  }

  /**
   * Validate templateExists parameters
   */
  private validateTemplateExistsParams(params: TemplateFetchParams): void {
    // Validate params object
    if (!params || typeof params !== 'object') {
      throw new BadRequestException(
        'Template fetch parameters are required',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { params },
      );
    }

    if (Array.isArray(params)) {
      throw new BadRequestException(
        'Template fetch parameters must be an object, not an array',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { params },
      );
    }

    // Validate templateKey
    if (!params.templateKey || typeof params.templateKey !== 'string') {
      throw new BadRequestException(
        'Template key is required and must be a string',
        ERROR_CODES.INVALID_TEMPLATE_KEY,
        undefined,
        { templateKey: params.templateKey, type: typeof params.templateKey },
      );
    }

    if (params.templateKey.trim() === '') {
      throw new BadRequestException(
        'Template key cannot be empty',
        ERROR_CODES.INVALID_TEMPLATE_KEY,
        undefined,
        { templateKey: params.templateKey },
      );
    }

    // Validate bucketName if provided
    if (params.bucketName !== undefined) {
      if (typeof params.bucketName !== 'string') {
        throw new BadRequestException(
          'Bucket name must be a string',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { bucketName: params.bucketName, type: typeof params.bucketName },
        );
      }

      if (params.bucketName.trim() === '') {
        throw new BadRequestException(
          'Bucket name cannot be empty',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { bucketName: params.bucketName },
        );
      }
    }

    // Validate cacheTtl if provided
    if (params.cacheTtl !== undefined) {
      if (typeof params.cacheTtl !== 'number') {
        throw new BadRequestException(
          'Cache TTL must be a number',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { cacheTtl: params.cacheTtl, type: typeof params.cacheTtl },
        );
      }

    }
  }

  /**
   * Check if template exists in S3
   */
  async templateExists(params: TemplateFetchParams): Promise<boolean> {
    // Validate params
    this.validateTemplateExistsParams(params);

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
        `Error checking template existence: ${templateKey} in bucket: ${bucket}`,
        error,
      );

      throw new InternalServerErrorException(
        'Failed to check template existence in S3',
        ERROR_CODES.TEMPLATE_FETCH_FAILED,
        undefined,
        {
          templateKey,
          bucket,
          error,
        },
      );
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
