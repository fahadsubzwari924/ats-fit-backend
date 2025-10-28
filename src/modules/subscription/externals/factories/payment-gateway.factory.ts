import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPaymentGateway } from '../interfaces/payment-gateway.interface';
import { LemonSqueezyPaymentGateway } from '../gateways/lemonsqueezy-payment.gateway';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../../shared/constants/error-codes';
import { 
  PaymentProvider, 
  getAllPaymentProviders, 
  isValidPaymentProvider 
} from '../../enums/payment-provider.enum';

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
      case PaymentProvider.LEMONSQUEEZY:
        return this.lemonSqueezyGateway as unknown as IPaymentGateway;

      case PaymentProvider.STRIPE:
        // return this.stripeGateway;
        throw new InternalServerErrorException(
          'Stripe payment gateway not implemented yet',
          ERROR_CODES.INTERNAL_SERVER,
        );

      case PaymentProvider.PADDLE:
        // return this.paddleGateway;
        throw new InternalServerErrorException(
          'Paddle payment gateway not implemented yet',
          ERROR_CODES.INTERNAL_SERVER,
        );

      case PaymentProvider.PAYPAL:
        throw new InternalServerErrorException(
          'PayPal payment gateway not implemented yet',
          ERROR_CODES.INTERNAL_SERVER,
        );

      default:
        throw new BadRequestException(
          `Unsupported payment provider: ${provider}`,
          ERROR_CODES.BAD_REQUEST,
        );
    }
  }

  /**
   * Get active payment provider from configuration
   */
  private getActivePaymentProvider(): PaymentProvider {
    const provider = this.configService
      .get<string>('PAYMENT_PROVIDER', PaymentProvider.LEMONSQUEEZY)
      .toLowerCase();

    if (!isValidPaymentProvider(provider)) {
      const supportedProviders = getAllPaymentProviders();
      throw new BadRequestException(
        `Invalid payment provider in configuration: ${provider}. Supported providers: ${supportedProviders.join(', ')}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return provider;
  }

  /**
   * Get list of supported payment providers
   */
  getSupportedProviders(): PaymentProvider[] {
    return getAllPaymentProviders();
  }

  /**
   * Get currently active payment provider
   */
  getActiveProvider(): PaymentProvider {
    return this.getActivePaymentProvider();
  }
}
