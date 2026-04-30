export interface BrevoEmailRecipient {
  email: string;
  name?: string;
}

export interface BrevoSender {
  name: string;
  email: string;
}

export interface BrevoTransactionalEmailPayload {
  to: BrevoEmailRecipient[];
  templateId: number;
  params: Record<string, unknown>;
  subject?: string;
  sender?: BrevoSender;
}

export interface BrevoSendResponse {
  messageId: string;
}
