import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EmailSendPayload, IEmailService } from '../interfaces/email.interface';
import {
  ITemplateProvider,
  TEMPLATE_PROVIDER_TOKEN,
} from '../interfaces/template-provider.interface';
import {
  ITemplateRenderer,
  TEMPLATE_RENDERER_TOKEN,
} from '../interfaces/template-renderer.interface';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

/**
 * AWS SES Email Service
 * 
 * Sends emails using AWS SES with template support from S3
 * Follows SOLID principles:
 * - Single Responsibility: Only handles email sending via SES
 * - Open/Closed: Extensible via template provider and renderer abstractions
 * - Dependency Inversion: Depends on abstractions (ITemplateProvider, ITemplateRenderer)
 * 
 * Architecture:
 * - Template Provider (S3TemplateProviderService): Fetches templates from S3
 * - Template Renderer (HandlebarsTemplateRendererService): Renders templates with data
 * - Email Service (AwsSesService): Sends rendered emails via AWS SES
 */
@Injectable()
export class AwsSesService implements IEmailService {
  private readonly logger = new Logger(AwsSesService.name);
  private readonly sesClient: SESClient;
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(TEMPLATE_PROVIDER_TOKEN)
    private readonly templateProvider: ITemplateProvider,
    @Inject(TEMPLATE_RENDERER_TOKEN)
    private readonly templateRenderer: ITemplateRenderer,
  ) {
    // Resolve sender info
    this.senderEmail =
      this.configService.get<string>('AWS_SES_FROM_EMAIL') ||
      'info@atsfitt.com';
    this.senderName =
      this.configService.get<string>('AWS_SES_FROM_NAME') || 'ATS Fit';

    // AWS credentials and region
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('AWS_SES_USER_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AES_SES_USER_SECRET_ACCESS_KEY',
    );

    this.logger.log(
      `AWS SES initialized - Region: ${region}, From: ${this.senderEmail}`,
    );

    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'AWS credentials not configured. Email sending may fail.',
      );
    }

    // Initialize SES client
    this.sesClient = new SESClient({
      region,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });

    this.logger.log('AWS SES Client initialized with template support from S3');
  }

  /**
   * Send an email using AWS SES
   * 
   * Payload options:
   * - subject, html, text: Direct content (overrides template)
   * - templateKey: Template identifier to fetch from S3
   * - templateData: Data to bind to template variables
   * - to: Recipient email (can be passed in payload or as parameter)
   * 
   * @param to Recipient email address
   * @param payload Email payload with content or template info
   * @returns SES send result
   */
  async send(to: string, payload: EmailSendPayload): Promise<unknown> {
    // Validate email address
    this.validateEmail(to);

    try {

      let html: string = '';
      let subject = payload.subject as string | undefined;

      // Fetch and render template if templateKey provided
      if (payload.templateKey && typeof payload.templateKey === 'string') {
        const rendered = await this.renderEmailTemplate(
          payload.templateKey,
          (payload.templateData as Record<string, unknown>) || {},
        );
        
        // Use template content but allow payload overrides
        html = rendered.html;
      }

      // Validation: at least subject or html/text required
      if (!subject || !html) {
        throw new BadRequestException(
          'Email must have subject, html, or text content',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { to, hasTemplateKey: !!payload.templateKey },
        );
      }

      // Default subject if not provided
      if (!subject) {
        subject = 'Notification from ATS Fit';
      }

      // Send email via SES
      return await this.sendViaSes(to, subject, html);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error('Failed to send email via AWS SES', {
        error: (error as Error).message,
        to,
        templateKey: payload.templateKey,
      });

      throw new InternalServerErrorException(
        'Failed to send email',
        ERROR_CODES.EMAIL_SEND_FAILED,
        undefined,
        {
          to,
          templateKey: payload.templateKey,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }
  }

  /**
   * Fetch template from S3 and render with data
   */
  private async renderEmailTemplate(
    templateKey: string,
    templateData: Record<string, unknown>,
  ): Promise<{ subject?: string; html?: string; text?: string }> {
    try {
      this.logger.log(`Fetching template from S3: ${templateKey}`);

      // Fetch template from S3 via provider
      const templateContent = await this.templateProvider.fetchTemplate({
        templateKey,
      });

      // Render template with data via renderer
      const rendered = await this.templateRenderer.render(
        templateContent,
        templateData,
      );

      this.logger.log(`Template rendered successfully: ${templateKey}`);
      return rendered;
    } catch (error) {
      this.logger.error(`Failed to render template: ${templateKey}`, error);
      throw new InternalServerErrorException(
        `Failed to render email template: ${templateKey}`,
        ERROR_CODES.EMAIL_TEMPLATE_RENDER_FAILED,
        undefined,
        {
          templateKey,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }
  }

  /**
   * Send email via AWS SES
   */
  private async sendViaSes(
    to: string,
    subject: string,
    html?: string,
    text?: string,
  ): Promise<unknown> {
    const fromAddress = `${this.senderName} <${this.senderEmail}>`;

    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          ...(html && {
            Html: {
              Data: html,
              Charset: 'UTF-8',
            },
          }),
          ...(text && {
            Text: {
              Data: text,
              Charset: 'UTF-8',
            },
          }),
        },
      },
    });

    this.logger.log(`Sending email to ${to} via AWS SES`);

    const result = await this.sesClient.send(command);

    this.logger.log(
      `Email sent successfully to ${to} (MessageId: ${result.MessageId})`,
    );

    return result;
  }

  /**
   * Validate email address format
   */
  private validateEmail(email: string): void {
    if (!email || typeof email !== 'string') {
      throw new BadRequestException(
        'Invalid email address',
        ERROR_CODES.INVALID_EMAIL_ADDRESS,
        undefined,
        { email },
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException(
        'Invalid email address format',
        ERROR_CODES.INVALID_EMAIL_ADDRESS,
        undefined,
        { email },
      );
    }
  }

  /**
   * Invalidate template cache (delegates to provider)
   */
  invalidateTemplate(templateKey: string): void {
    this.templateProvider.invalidateCache(templateKey);
    this.logger.log(`Template cache invalidated: ${templateKey}`);
  }

  /**
   * Check if template exists in S3
   */
  async templateExists(templateKey: string): Promise<boolean> {
    return this.templateProvider.templateExists({ templateKey });
  }
}
