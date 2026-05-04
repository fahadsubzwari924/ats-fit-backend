import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrevoTransactionalEmailPayload,
  BrevoRawEmailPayload,
  BrevoSendResponse,
  BrevoSender,
} from '../../../interfaces/brevo-email.interface';
import { InternalServerErrorException } from '../../../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../constants/error-codes';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Direct Brevo email client.
 * - sendTransactionalEmail: template-based (templateId + params)
 * - sendRawEmail: inline HTML, no Brevo template required
 * Not wired to EMAIL_SERVICE_TOKEN (IEmailService signature is SES-specific).
 */
@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);
  private readonly apiKey: string;
  private readonly defaultSender: BrevoSender;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('BREVO_API_KEY') ?? '';
    if (!this.apiKey) {
      this.logger.warn(
        'BREVO_API_KEY is not configured — Brevo email sending will fail at runtime',
      );
    }
    this.defaultSender = {
      email:
        this.configService.get<string>('BREVO_FROM_EMAIL') ??
        'hello@tairly.com',
      name: this.configService.get<string>('BREVO_FROM_NAME') ?? 'Tailry',
    };
  }

  async sendTransactionalEmail(
    payload: BrevoTransactionalEmailPayload,
  ): Promise<BrevoSendResponse> {
    const body = {
      sender: this.defaultSender,
      ...payload,
    };

    this.logger.log(
      `Sending Brevo template ${payload.templateId} to ${payload.to.map((r) => r.email).join(', ')} from ${body.sender.email}`,
    );

    try {
      const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        this.logger.error(
          `Brevo API error ${response.status}: ${responseBody}`,
        );
        throw new InternalServerErrorException(
          'Failed to send email',
          ERROR_CODES.EMAIL_SEND_FAILED,
          undefined,
          { status: response.status, body: responseBody },
        );
      }

      const result = (await response.json()) as BrevoSendResponse;
      this.logger.log(`Brevo email sent. MessageId: ${result.messageId}`);
      return result;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error('Brevo network error', (error as Error).message);
      throw new InternalServerErrorException(
        'Failed to send email',
        ERROR_CODES.EMAIL_SEND_FAILED,
        undefined,
        { error: (error as Error).message },
      );
    }
  }

  async sendRawEmail(
    payload: BrevoRawEmailPayload,
  ): Promise<BrevoSendResponse> {
    const body = {
      sender: payload.sender ?? this.defaultSender,
      to: payload.to,
      subject: payload.subject,
      htmlContent: payload.htmlContent,
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    };

    this.logger.log(
      `Sending raw Brevo email "${payload.subject}" to ${payload.to.map((r) => r.email).join(', ')}`,
    );

    try {
      const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const responseBody = await response.text();
        this.logger.error(
          `Brevo raw email error ${response.status}: ${responseBody}`,
        );
        throw new InternalServerErrorException(
          'Failed to send email',
          ERROR_CODES.EMAIL_SEND_FAILED,
          undefined,
          { status: response.status, body: responseBody },
        );
      }

      const result = (await response.json()) as BrevoSendResponse;
      this.logger.log(`Brevo raw email sent. MessageId: ${result.messageId}`);
      return result;
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      this.logger.error('Brevo network error', (error as Error).message);
      throw new InternalServerErrorException(
        'Failed to send email',
        ERROR_CODES.EMAIL_SEND_FAILED,
        undefined,
        { error: (error as Error).message },
      );
    }
  }
}
