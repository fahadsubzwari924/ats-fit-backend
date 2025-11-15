export interface IEmailService {
  /**
   * Send a transactional email.
   * Keep the signature minimal so existing callers (send(to, payload)) keep working.
   * @param to - recipient email address
   * @param payload - arbitrary payload / template data
   */
  send(to: string, payload: Record<string, any>): Promise<any>;
}

export const EMAIL_SERVICE_TOKEN = Symbol('IEmailService');