/**
 * Template Provider Interface
 * 
 * Abstraction for template retrieval from various sources (S3, disk, database, etc.)
 * Following Interface Segregation Principle (ISP) and Dependency Inversion Principle (DIP)
 */

export interface TemplateContent {
  subject?: string;
  html?: string;
  text?: string;
}

export interface TemplateFetchParams {
  templateKey: string;
  bucketName?: string;
  cacheTtl?: number;
}

/**
 * Abstract template provider interface
 * Implementations can fetch templates from S3, disk, database, etc.
 */
export interface ITemplateProvider {
  /**
   * Fetch template content by key
   * @param params Template fetch parameters
   * @returns Template content (subject, html, text)
   */
  fetchTemplate(params: TemplateFetchParams): Promise<TemplateContent>;

  /**
   * Check if template exists
   * @param params Template fetch parameters
   * @returns Boolean indicating template existence
   */
  templateExists(params: TemplateFetchParams): Promise<boolean>;

  /**
   * Invalidate cached template
   * @param templateKey Template identifier
   */
  invalidateCache(templateKey: string): void;
}

/**
 * Token for dependency injection
 */
export const TEMPLATE_PROVIDER_TOKEN = Symbol('TEMPLATE_PROVIDER');
