import { InjectMailchimp } from '@mindik/mailchimp-nestjs';
import { Injectable } from '@nestjs/common';
import { IEmailService } from '../interfaces/email.interface';
import { ConfigService } from '@nestjs/config';

/**
 * Mailchimp transactional implementation of IEmailService.
 * Registered under the DI token 'IEmailService' in SharedModule.
 */
@Injectable()
export class MailchimpTransactionalService implements IEmailService {
  constructor(
    @InjectMailchimp() private readonly mailchimp: any,
    private readonly configService: ConfigService,
  ) {} // keep 'any' to avoid coupling; can type as needed

  /**
   * Minimal send implementation so existing callers continue to work.
   * payload can contain { amount, orderId } or any template data required.
   */
  async send(to: string, payload: Record<string, any>): Promise<any> {
    try {

      const response = await this.mailchimp.messages.send({ message: this.createEmail(payload, to) });
      return response;
    } catch (error) {
      // Keep behavior simple: log and rethrow so callers can handle failures
      // In production you may want to swallow certain errors or implement retry
      // logic; keep it simple and visible for now.
      // eslint-disable-next-line no-console
      console.error('MailchimpTransactionalService.send error:', error);
      throw error;
    }
  }

  private createEmail(payload: Record<string, any>, to: string) {
    const fromEmail = this.configService.get<string>('MAILCHIMP_FROM_EMAIL') || 'info@atsfitt.com';
    const fromName = this.configService.get<string>('MAILCHIMP_FROM_NAME') || 'ATS Fit';
    const defaultSubject = this.configService.get<string>('MAILCHIMP_PAYMENT_FAILURE_SUBJECT') || 'Notification from ATS Fit';
    const subject = payload.subject || defaultSubject;

    return {
      from_email: fromEmail,
      from_name: fromName,
      subject,
      text:
        payload.text ||
        `You have a new notification. Details: ${JSON.stringify(payload)}`,
      html:
        payload.html ||
        `<p>You have a new notification. Details: <pre>${JSON.stringify(
          payload,
          null,
          2,
        )}</pre></p>`,
      to: [{ email: to, type: 'to' }],
      track_opens: true,
      track_clicks: true,
    };

  }
}