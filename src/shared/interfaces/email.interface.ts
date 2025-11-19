import { IAwsEmailConfig } from "./aws-email-config.interface";
import { IEmailSenderConfig } from "./email-sender-config.interface";
import { IRecipients } from "./recipient.interface";

export interface IEmailService {
  /**
   * Send a transactional email.
   * Keep the signature minimal so existing callers (send(to, payload)) keep working.
   * @param to - recipient email address
   * @param payload - arbitrary payload / template data
   */
  sendEmail(awsConfig: IAwsEmailConfig, recipients: IRecipients, senderConfig: IEmailSenderConfig, payload: EmailSendPayload): Promise<any>;
}

export interface EmailSendPayload {
  templateKey: string;
  templateData: Record<string, unknown>;
  subject?: string;
}

export const EMAIL_SERVICE_TOKEN = Symbol('IEmailService');