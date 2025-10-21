import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPaymentGateway } from '../interfaces/payment-gateway.interface';
import { LemonSqueezyPaymentGateway } from '../gateways/lemonsqueezy-payment.gateway';

export type PaymentProvider = 'lemonsqueezy' | 'stripe' | 'paddle' | 'paypal';

/**
 * Payment Gateway Factory
 * 
 * This factory creates the appropriate payment gateway based on configuration.
 * Makes it easy to switch between payment providers without changing application code.
 */
@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly lemonSqueezyGateway: LemonSqueezyPaymentGateway,
    // Add other gateways here when implemented
    // private readonly stripeGateway: StripePaymentGateway,
    // private readonly paddleGateway: PaddlePaymentGateway,
  ) {}

  /**
   * Create payment gateway based on configuration
   */
  createPaymentGateway(): IPaymentGateway {
    const provider = this.getActivePaymentProvider();

    switch (provider) {
      case 'lemonsqueezy':
        return this.lemonSqueezyGateway as unknown as IPaymentGateway;
      
      case 'stripe':
        // return this.stripeGateway;
        throw new Error('Stripe payment gateway not implemented yet');
      
      case 'paddle':
        // return this.paddleGateway;
        throw new Error('Paddle payment gateway not implemented yet');
      
      case 'paypal':
        throw new Error('PayPal payment gateway not implemented yet');
      
      default:
        throw new Error(`Unsupported payment provider: ${provider}`);
    }
  }

  /**
   * Get active payment provider from configuration
   */
  private getActivePaymentProvider(): PaymentProvider {
    const provider = this.configService.get<string>('PAYMENT_PROVIDER', 'lemonsqueezy').toLowerCase();
    
    const supportedProviders: PaymentProvider[] = ['lemonsqueezy', 'stripe', 'paddle', 'paypal'];
    
    if (!supportedProviders.includes(provider as PaymentProvider)) {
      throw new Error(`Invalid payment provider in configuration: ${provider}. Supported providers: ${supportedProviders.join(', ')}`);
    }
    
    return provider as PaymentProvider;
  }

  /**
   * Get list of supported payment providers
   */
  getSupportedProviders(): PaymentProvider[] {
    return ['lemonsqueezy', 'stripe', 'paddle', 'paypal'];
  }

  /**
   * Get currently active payment provider
   */
  getActiveProvider(): PaymentProvider {
    return this.getActivePaymentProvider();
  }
}