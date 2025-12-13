/**
 * Template Renderer Interface
 * 
 * Abstraction for template rendering engines (Handlebars, EJS, Pug, etc.)
 * Following Interface Segregation Principle (ISP) and Single Responsibility Principle (SRP)
 */

export interface RenderContext {
  [key: string]: unknown;
}

export interface RenderedTemplate {
  subject?: string;
  html?: string;
  text?: string;
}

/**
 * Abstract template renderer interface
 * Implementations can use different rendering engines
 */
export interface ITemplateRenderer {
  /**
   * Render template with provided data
   * @param templateSource Raw template source (subject, html, text)
   * @param context Data to bind to template
   * @returns Rendered template content
   */
  bindTemplate(
    templateSource: string,
    context: RenderContext,
  ): Promise<string>;

  /**
   * Compile template for better performance (optional)
   * @param templateSource Raw template source
   * @returns Compiled template reference (implementation-specific)
   */
  compile?(templateSource: string): unknown;
}

/**
 * Token for dependency injection
 */
export const TEMPLATE_RENDERER_TOKEN = Symbol('TEMPLATE_RENDERER');
