import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EmailSendPayload, IEmailService } from '../../../interfaces/email.interface';
import {
  ITemplateProvider,
  TEMPLATE_PROVIDER_TOKEN,
} from '../../../interfaces/template-provider.interface';
import {
  ITemplateRenderer,
  TEMPLATE_RENDERER_TOKEN,
} from '../../../interfaces/template-renderer.interface';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../constants/error-codes';
import { IRecipients, IAwsEmailConfig, IEmailSenderConfig } from '../../../interfaces';

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
  private sesClient: SESClient;
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(TEMPLATE_PROVIDER_TOKEN)
    private readonly templateProvider: ITemplateProvider,
    @Inject(TEMPLATE_RENDERER_TOKEN)
    private readonly templateRenderer: ITemplateRenderer,
  ) {
  }

  private buildSesClient(awsConfig: IAwsEmailConfig): SESClient {

    // Validate AWS configuration
    this.validateAwsConfig(awsConfig);

    return new SESClient({
      region: awsConfig.region,
      credentials:
        awsConfig.accessKeyId && awsConfig.secretAccessKey
          ? { accessKeyId: awsConfig.accessKeyId, secretAccessKey: awsConfig.secretAccessKey }
          : undefined,
    });
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
  async sendEmail(awsConfig: IAwsEmailConfig, recipients: IRecipients, senderConfig: IEmailSenderConfig, payload: EmailSendPayload): Promise<unknown> {

    this.validateSendEmailParams(recipients, senderConfig, payload);
   
    this.sesClient = this.buildSesClient(awsConfig);

    try {

      let html: string = '';
      let subject = payload?.subject as string | undefined;

      // Fetch template from S3 via provider
      const templateContent = await this.templateProvider.fetchTemplate({
        templateKey: payload?.templateKey,
      });

      const rendered = await this.renderEmailTemplate(
        templateContent,
        payload?.templateData,
      );
      
      // Use template content but allow payload overrides
      html = rendered;
    

      // Validation: at least subject or html/text required
      if (!html) {
        throw new BadRequestException(
          'Email must have subject, html, or text content',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { recipients: recipients.emailsTo, hasTemplateKey: !!payload.templateKey },
        );
      }

      // Default subject if not provided
      if (!subject) {
        subject = 'Notification from ATS Fit';
      }

      // Send email via SES to all recipients
      return await this.sendViaSes(recipients, senderConfig, subject, html);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error('Failed to send email via AWS SES', {
        error: (error as Error).message,
        recipients: recipients.emailsTo,
        templateKey: payload.templateKey,
      });

      throw new InternalServerErrorException(
        'Failed to send email',
        ERROR_CODES.EMAIL_SEND_FAILED,
        undefined,
        {
          recipients: recipients.emailsTo,
          templateKey: payload.templateKey,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }
  }

  private validateSendEmailParams(recipients: IRecipients, senderConfig: IEmailSenderConfig, payload: EmailSendPayload): void {

    // Validate sender configuration
    this.validateSenderConfig(senderConfig);

    // Validate all email addresses
    if (!recipients.emailsTo || !Array.isArray(recipients.emailsTo) || recipients.emailsTo.length === 0) {
      throw new BadRequestException(
        'At least one recipient email is required',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { recipients },
      );
    }

    // Validate each email individually
    recipients.emailsTo.forEach((email, index) => {
      this.validateEmail(email, index);
    });

    // Validate payload
    this.validateSendEmailPayload(payload);

    this.validateTemplateData(payload?.templateData);
  }

  /**
   * Fetch template from S3 and render with data
   */
  private async renderEmailTemplate(
    templateContent: string,
    templateData: Record<string, unknown>,
  ): Promise<string> {

    // Validate template content
    this.validateTemplateContent(templateContent);

    // Validate parameters
    this.validateRenderEmailTemplateParams(templateData);
    try {

      // Render template with data via renderer
      const rendered = await this.templateRenderer.bindTemplate(
        templateContent,
        templateData,
      );

      return rendered;
    } catch (error) {
      this.logger.error('Failed to render template', error);
      throw new InternalServerErrorException(
        'Failed to render email template',
        ERROR_CODES.EMAIL_TEMPLATE_RENDER_FAILED,
        undefined,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }
  }

  /**
   * Send email via AWS SES
   */
  private async sendViaSes(
    recipients: IRecipients,
    senderConfig: IEmailSenderConfig,
    subject: string,
    html: string,
  ): Promise<unknown> {
    const fromAddress = `${senderConfig.senderName} <${senderConfig.fromAddress}>`;

    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: {
        ToAddresses: recipients?.emailsTo,
        CcAddresses: recipients?.emailsCc.length ? recipients.emailsCc : [],
        BccAddresses: recipients?.emailsBcc.length ? recipients.emailsBcc : [],
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
        },
      },
    });

    this.logger.log(`Sending email to ${recipients.emailsTo.join(', ')} via AWS SES`);

    const result = await this.sesClient.send(command);

    this.logger.log(
      `Email sent successfully to ${recipients.emailsTo.join(', ')} (MessageId: ${result.MessageId})`,
    );

    return result;
  }

  /**
   * Validate renderEmailTemplate parameters
   */
  private validateRenderEmailTemplateParams(
    templateData: Record<string, unknown>,
  ): void {

    // Validate templateData parameter
    if (!templateData || typeof templateData !== 'object') {
      throw new BadRequestException(
        'Template data is required and must be an object',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { templateData, type: typeof templateData },
      );
    }

    if (Array.isArray(templateData)) {
      throw new BadRequestException(
        'Template data must be a plain object, not an array',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { templateData },
      );
    }
  }

  /**
   * Validate AWS configuration
   */
  private validateAwsConfig(awsConfig: IAwsEmailConfig): void {
    if (!awsConfig || typeof awsConfig !== 'object') {
      throw new BadRequestException(
        'AWS configuration is required',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { awsConfig },
      );
    }

    if (Array.isArray(awsConfig)) {
      throw new BadRequestException(
        'AWS configuration must be an object, not an array',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { awsConfig },
      );
    }

    // Validate region
    if (!awsConfig.region || typeof awsConfig.region !== 'string') {
      throw new BadRequestException(
        'AWS region is required and must be a string',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { region: awsConfig.region },
      );
    }

    if (awsConfig.region.trim() === '') {
      throw new BadRequestException(
        'AWS region cannot be empty',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { region: awsConfig.region },
      );
    }

    // Validate credentials if provided
    if (awsConfig.accessKeyId !== undefined) {
      if (typeof awsConfig.accessKeyId !== 'string') {
        throw new BadRequestException(
          'AWS access key ID must be a string',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { accessKeyId: typeof awsConfig.accessKeyId },
        );
      }

      if (awsConfig.accessKeyId.trim() === '') {
        throw new BadRequestException(
          'AWS access key ID cannot be empty',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { accessKeyId: awsConfig.accessKeyId },
        );
      }
    }

    if (awsConfig.secretAccessKey !== undefined) {
      if (typeof awsConfig.secretAccessKey !== 'string') {
        throw new BadRequestException(
          'AWS secret access key must be a string',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { secretAccessKey: 'invalid type' },
        );
      }

      if (awsConfig.secretAccessKey.trim() === '') {
        throw new BadRequestException(
          'AWS secret access key cannot be empty',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { secretAccessKey: 'empty string' },
        );
      }
    }

    // Both credentials must be provided together
    if ((awsConfig.accessKeyId && !awsConfig.secretAccessKey) ||
        (!awsConfig.accessKeyId && awsConfig.secretAccessKey)) {
      throw new BadRequestException(
        'AWS access key ID and secret access key must be provided together',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        {
          hasAccessKeyId: !!awsConfig.accessKeyId,
          hasSecretAccessKey: !!awsConfig.secretAccessKey,
        },
      );
    }
  }

  /**
   * Validate sender configuration
   */
  private validateSenderConfig(senderConfig: IEmailSenderConfig): void {
    if (!senderConfig || typeof senderConfig !== 'object') {
      throw new BadRequestException(
        'Sender configuration is required',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { senderConfig },
      );
    }

    if (Array.isArray(senderConfig)) {
      throw new BadRequestException(
        'Sender configuration must be an object, not an array',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { senderConfig },
      );
    }

    // Validate fromAddress
    if (!senderConfig.fromAddress || typeof senderConfig.fromAddress !== 'string') {
      throw new BadRequestException(
        'Sender email address is required and must be a string',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { fromAddress: senderConfig.fromAddress },
      );
    }

    if (senderConfig.fromAddress.trim() === '') {
      throw new BadRequestException(
        'Sender email address cannot be empty',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { fromAddress: senderConfig.fromAddress },
      );
    }

    // Validate fromAddress format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(senderConfig.fromAddress.trim())) {
      throw new BadRequestException(
        'Sender email address format is invalid',
        ERROR_CODES.INVALID_EMAIL_ADDRESS,
        undefined,
        { fromAddress: senderConfig.fromAddress },
      );
    }

    // Validate senderName
    if (!senderConfig.senderName || typeof senderConfig.senderName !== 'string') {
      throw new BadRequestException(
        'Sender name is required and must be a string',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { senderName: senderConfig.senderName },
      );
    }

    if (senderConfig.senderName.trim() === '') {
      throw new BadRequestException(
        'Sender name cannot be empty',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { senderName: senderConfig.senderName },
      );
    }
  }

  /**
   * Validate email payload
   */
  private validateSendEmailPayload(payload: EmailSendPayload): void {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException(
        'Email payload is required',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { payload },
      );
    }

    if (Array.isArray(payload)) {
      throw new BadRequestException(
        'Email payload must be an object, not an array',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { payload },
      );
    }

    // Validate templateKey if provided
    if (payload.templateKey !== undefined) {
      if (typeof payload.templateKey !== 'string') {
        throw new BadRequestException(
          'Template key must be a string',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { templateKey: payload.templateKey, type: typeof payload.templateKey },
        );
      }

      if (payload.templateKey.trim() === '') {
        throw new BadRequestException(
          'Template key cannot be empty',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { templateKey: payload.templateKey },
        );
      }
    }

    // Validate subject if provided
    if (payload.subject !== undefined) {
      if (typeof payload.subject !== 'string') {
        throw new BadRequestException(
          'Email subject must be a string',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { subject: payload.subject, type: typeof payload.subject },
        );
      }

      if (payload.subject.trim() === '') {
        throw new BadRequestException(
          'Email subject cannot be empty',
          ERROR_CODES.BAD_REQUEST,
          undefined,
          { subject: payload.subject },
        );
      }
    }
  }

  /**
   * Validate and sanitize template data
   */
  private validateTemplateData(templateData: unknown): Record<string, unknown> {
    if (templateData === undefined || templateData === null) {
      return {};
    }

    if (typeof templateData !== 'object') {
      throw new BadRequestException(
        'Template data must be an object',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { templateData, type: typeof templateData },
      );
    }

    if (Array.isArray(templateData)) {
      throw new BadRequestException(
        'Template data must be a plain object, not an array',
        ERROR_CODES.BAD_REQUEST,
        undefined,
        { templateData },
      );
    }

    // Return as Record<string, unknown>
    return templateData as Record<string, unknown>;
  }

  /**
   * Validate template content
   */
  private validateTemplateContent(templateContent: string): void {
    if (!templateContent) {
      throw new InternalServerErrorException(
        'Template content is empty or not found',
        ERROR_CODES.EMAIL_TEMPLATE_RENDER_FAILED,
        undefined,
        { reason: 'Template content is empty or undefined' },
      );
    }

    if (typeof templateContent !== 'string') {
      throw new InternalServerErrorException(
        'Template content must be a string',
        ERROR_CODES.EMAIL_TEMPLATE_RENDER_FAILED,
        undefined,
        { 
          reason: 'Invalid template content type',
          receivedType: typeof templateContent,
        },
      );
    }

    if (templateContent.trim() === '') {
      throw new InternalServerErrorException(
        'Template content cannot be empty',
        ERROR_CODES.EMAIL_TEMPLATE_RENDER_FAILED,
        undefined,
        { reason: 'Template content is an empty string' },
      );
    }
  }

  /**
   * Validate email address format
   * Validates one email at a time
   */
  private validateEmail(email: string, index?: number): void {
    if (!email || typeof email !== 'string') {
      throw new BadRequestException(
        'Invalid email address',
        ERROR_CODES.INVALID_EMAIL_ADDRESS,
        undefined,
        { email, position: index !== undefined ? index + 1 : undefined },
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new BadRequestException(
        'Invalid email address format',
        ERROR_CODES.INVALID_EMAIL_ADDRESS,
        undefined,
        { email, position: index !== undefined ? index + 1 : undefined },
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
