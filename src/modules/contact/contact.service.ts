import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoService } from '../../shared/modules/external/services/brevo.service';
import { SubmitContactDto } from './dto/submit-contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly notificationEmail: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(
    private readonly brevoService: BrevoService,
    private readonly configService: ConfigService,
  ) {
    const adminFirst = (this.configService.get<string>('ADMIN_EMAILS') ?? '')
      .split(',')[0]
      .trim();
    this.notificationEmail =
      this.configService.get<string>('CONTACT_NOTIFICATION_EMAIL') ??
      (adminFirst || 'info@tairly.com');

    this.fromEmail =
      this.configService.get<string>('BREVO_FROM_EMAIL') ?? 'hello@tairly.com';
    this.fromName =
      this.configService.get<string>('BREVO_FROM_NAME') ?? 'Tairly';
  }

  async submit(dto: SubmitContactDto): Promise<void> {
    await Promise.all([
      this.sendOwnerNotification(dto),
      this.sendAutoReply(dto),
    ]);
  }

  private async sendOwnerNotification(dto: SubmitContactDto): Promise<void> {
    const html = `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a;">
        <div style="background: #2563eb; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700;">
            New Contact Form Submission
          </h1>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 32px; border-radius: 0 0 12px 12px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: #64748b; width: 90px; vertical-align: top;">Name</td>
              <td style="padding: 8px 0; font-size: 15px; color: #0f172a;">${this.escapeHtml(dto.name)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: #64748b; vertical-align: top;">Email</td>
              <td style="padding: 8px 0; font-size: 15px; color: #0f172a;">
                <a href="mailto:${this.escapeHtml(dto.email)}" style="color: #2563eb;">${this.escapeHtml(dto.email)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: #64748b; vertical-align: top;">Subject</td>
              <td style="padding: 8px 0; font-size: 15px; color: #0f172a;">${this.escapeHtml(dto.subject)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0 0; font-size: 13px; font-weight: 600; color: #64748b; vertical-align: top;">Message</td>
              <td style="padding: 8px 0 0; font-size: 15px; color: #0f172a; white-space: pre-wrap;">${this.escapeHtml(dto.message)}</td>
            </tr>
          </table>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px;">
          <p style="margin: 0; font-size: 12px; color: #94a3b8;">
            Reply directly to this email to respond to ${this.escapeHtml(dto.name)}.
          </p>
        </div>
      </div>
    `;

    await this.brevoService.sendRawEmail({
      to: [{ email: this.notificationEmail, name: 'Tairly Support' }],
      subject: `[Contact] ${dto.subject} — ${dto.name}`,
      htmlContent: html,
      replyTo: { email: dto.email, name: dto.name },
    });
  }

  private async sendAutoReply(dto: SubmitContactDto): Promise<void> {
    const html = `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a;">
        <div style="background: #2563eb; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700;">
            We got your message
          </h1>
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none; padding: 32px; border-radius: 0 0 12px 12px;">
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">
            Hi ${this.escapeHtml(dto.name)},
          </p>
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">
            Thanks for reaching out! We've received your message and will get back to you within <strong>1–2 business days</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
            <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em;">Your message</p>
            <p style="margin: 0; font-size: 14px; color: #475569; white-space: pre-wrap;">${this.escapeHtml(dto.message)}</p>
          </div>
          <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.6; color: #334155;">
            In the meantime, you can check our <a href="https://tairly.com/#faq" style="color: #2563eb;">FAQ</a> — it answers the most common questions about Tairly.
          </p>
          <p style="margin: 24px 0 0; font-size: 15px; color: #334155;">
            — The Tairly team
          </p>
        </div>
        <p style="text-align: center; margin: 16px 0 0; font-size: 12px; color: #94a3b8;">
          Tairly · AI Resume Tailoring · <a href="https://tairly.com" style="color: #94a3b8;">tairly.com</a>
        </p>
      </div>
    `;

    await this.brevoService.sendRawEmail({
      to: [{ email: dto.email, name: dto.name }],
      subject: `We received your message — Tairly`,
      htmlContent: html,
    });
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
