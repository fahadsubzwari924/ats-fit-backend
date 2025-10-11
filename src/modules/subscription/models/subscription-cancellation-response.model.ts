export class SubscriptionCancellationResponse {
  id: string;
  status: string;
  provider: string;
  cancelledAt: Date;
  endsAt: Date;
  message: string;
  success: boolean;

  constructor(data: {
    id: string;
    status: string;
    provider: string;
    cancelledAt: Date;
    endsAt: Date;
    message: string;
    success: boolean;
  }) {
    this.id = data.id;
    this.status = data.status;
    this.provider = data.provider;
    this.cancelledAt = data.cancelledAt;
    this.endsAt = data.endsAt;
    this.message = data.message;
    this.success = data.success;
  }

  /**
   * Create instance from the return object structure
   */
  static fromResponse(cancelResult: any, provider: string, message: string): SubscriptionCancellationResponse {
    return new SubscriptionCancellationResponse({
      id: cancelResult.subscriptionId,
      status: cancelResult.status,
      provider: provider,
      cancelledAt: cancelResult.cancelledAt,
      endsAt: cancelResult.endsAt,
      message: message,
      success: true
    });
  }

  /**
   * Convert to plain object (useful for API responses)
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      status: this.status,
      provider: this.provider,
      cancelledAt: this.cancelledAt,
      endsAt: this.endsAt,
      message: this.message,
      success: this.success
    };
  }
}