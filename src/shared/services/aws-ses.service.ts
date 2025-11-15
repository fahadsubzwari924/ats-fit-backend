import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import * as fs from 'fs/promises';
import * as path from 'path';
import Handlebars from 'handlebars';
import { IEmailService } from '../interfaces/email.interface';

type CompiledTemplates = {
  subject?: Handlebars.TemplateDelegate;
  html?: Handlebars.TemplateDelegate;
  text?: Handlebars.TemplateDelegate;
};

/**
 * AWS SES email sender using AWS SDK v3.
 * - Uses IAM credentials (access key + secret) from env via ConfigService
 * - Supports templateKey + templateData (templates on disk at src/shared/templates/<key>/)
 * - Caches compiled templates in-memory
 * - Implements IEmailService so it can be swapped via DI
 */
@Injectable()
export class AwsSesService implements IEmailService {
  private readonly logger = new Logger(AwsSesService.name);
  private readonly sesClient: SESClient;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly templateFolder: string;
  private readonly cache = new Map<string, CompiledTemplates>();

  constructor(private readonly configService: ConfigService) {
    // Resolve sender info
    this.senderEmail =
      this.configService.get<string>('AWS_SES_FROM_EMAIL') ||
      'info@atsfitt.com';
    this.senderName =
      this.configService.get<string>('AWS_SES_FROM_NAME') || 'ATS Fit';

    // Template folder (provider-agnostic templates on disk)
    this.templateFolder = path.resolve(__dirname, '..', 'templates');

    // AWS credentials and region
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>(
      'AWS_SES_USER_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.get<string>(
      'AES_SES_USER_SECRET_ACCESS_KEY',
    );

    this.logger.log(
      `AWS SES Config - Region: ${region}, AccessKeyId: ${accessKeyId?.substring(0, 10)}..., From: ${this.senderEmail}`,
    );

    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'AWS credentials are not fully configured. Email sending may fail. Ensure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set.',
      );
    }

    // Initialize SES client
    this.sesClient = new SESClient({
      region,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined, // Will use default credential chain if not provided
    });

    this.logger.log('AWS SES Client initialized successfully');

    // Register minimal Handlebars helpers
    Handlebars.registerHelper('uppercase', (str: string) =>
      String(str || '').toUpperCase(),
    );
  }

  /**
   * Send an email using AWS SES.
   * payload options:
   * - subject, html, text : direct overrides
   * - templateKey, templateData : load and render templates from disk
   */
  async send(to: string, payload: Record<string, unknown>): Promise<unknown> {
    try {
      let subject = payload.subject as string | undefined;
      let html = payload.html as string | undefined;
      let text = payload.text as string | undefined;

      // Render templates if templateKey is provided
      if (payload.templateKey && typeof payload.templateKey === 'string') {
        const rendered = await this.renderTemplate(
          payload.templateKey,
          (payload.templateData as Record<string, unknown>) || {},
        );
        subject = subject || rendered.subject;
        html = html || rendered.html;
        text = text || rendered.text;
      }

      // Default subject
      if (!subject) {
        subject = 'Notification from ATS Fit';
      }

      // Default content if none provided
      if (!html && !text) {
        text = `Notification: ${JSON.stringify(payload)}`;
      }

      // Prepare email command
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

      this.logger.log(
        `Sending email to ${to} using AWS SES (from ${this.senderEmail})`,
      );

      const result = await this.sesClient.send(command);

      this.logger.log(
        `Email sent successfully to ${to} (MessageId: ${result.MessageId || 'n/a'})`,
      );

      return result;
    } catch (error) {
      this.logger.error('Failed to send email via AWS SES', {
        error: (error as Error).message,
        to,
        payloadPreview: {
          subject: payload.subject,
          templateKey: payload.templateKey,
        },
      });
      throw error;
    }
  }

  private async renderTemplate(
    key: string,
    data: Record<string, unknown>,
  ): Promise<{ subject?: string; html?: string; text?: string }> {
    try {
      const compiled = await this.getCompiledTemplates(key);
      const out: { subject?: string; html?: string; text?: string } = {};

      if (compiled.subject) {
        out.subject = compiled.subject(data).replace(/\s+/g, ' ').trim();
      }
      if (compiled.html) {
        out.html = compiled.html(data);
      }
      if (compiled.text) {
        out.text = compiled.text(data);
      }

      return out;
    } catch (err) {
      this.logger.warn(`Template render failed for key=${key}: ${String(err)}`);
      return {};
    }
  }

  private async getCompiledTemplates(key: string): Promise<CompiledTemplates> {
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (cached) return cached;
    }

    const folder = path.join(this.templateFolder, key);
    const compileIfExists = async (fileName: string) => {
      try {
        const p = path.join(folder, fileName);
        const source = await fs.readFile(p, 'utf8');
        return Handlebars.compile(source);
      } catch {
        return undefined;
      }
    };

    const compiled: CompiledTemplates = {
      subject: await compileIfExists('subject.hbs'),
      html: await compileIfExists('html.hbs'),
      text: await compileIfExists('text.hbs'),
    };

    this.cache.set(key, compiled);
    return compiled;
  }

  /**
   * Invalidate cached templates for a key (call after editing templates on disk)
   */
  invalidateTemplate(key: string): void {
    this.cache.delete(key);
  }
}
