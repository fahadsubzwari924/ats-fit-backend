import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { ICreateSubscriptionPlanData } from '../interfaces/subscription.interface';

export class SubscriptionPlanValidator {
  private static readonly VALIDATION_RULES = {
    PLAN_NAME: {
      required: true,
      minLength: 1,
      message: 'Plan name is required and cannot be empty'
    },
    DESCRIPTION: {
      required: true,
      minLength: 1,
      message: 'Plan description is required and cannot be empty'
    },
    PRICE: {
      required: true,
      min: 0,
      message: 'Price is required and must be a non-negative number'
    },
    EXTERNAL_VARIANT_ID: {
      required: true,
      minLength: 1,
      message: 'External payment gateway variant ID is required'
    }
  };

  static validateCreateData(data: ICreateSubscriptionPlanData): void {
    this.validateDataObject(data);
    this.validateRequiredFields(data);
  }

  private static validateDataObject(data: any): void {
    if (!data || typeof data !== 'object') {
      throw new BadRequestException(
        'Subscription plan data is required',
        ERROR_CODES.BAD_REQUEST
      );
    }
  }

  private static validateRequiredFields(data: ICreateSubscriptionPlanData): void {
    const validationErrors: string[] = [];

    // Validate plan name
    if (!this.isValidString(data.plan_name)) {
      validationErrors.push(this.VALIDATION_RULES.PLAN_NAME.message);
    }

    // Validate description
    if (!this.isValidString(data.description)) {
      validationErrors.push(this.VALIDATION_RULES.DESCRIPTION.message);
    }

    // Validate price
    if (!this.isValidPrice(data.price)) {
      validationErrors.push(this.VALIDATION_RULES.PRICE.message);
    }

    // Validate external variant ID
    if (!this.isValidString(data.external_payment_gateway_variant_id)) {
      validationErrors.push(this.VALIDATION_RULES.EXTERNAL_VARIANT_ID.message);
    }

    if (validationErrors.length > 0) {
      throw new BadRequestException(
        validationErrors.join(', '),
        ERROR_CODES.BAD_REQUEST
      );
    }
  }

  private static isValidString(value: any): boolean {
    return value && typeof value === 'string' && value.trim().length > 0;
  }

  private static isValidPrice(price: any): boolean {
    return price !== undefined && price !== null && typeof price === 'number' && price >= 0;
  }

  static sanitizeCreateData(data: ICreateSubscriptionPlanData): ICreateSubscriptionPlanData {
    return {
      ...data,
      plan_name: data.plan_name?.trim(),
      description: data.description?.trim(),
      external_payment_gateway_variant_id: data.external_payment_gateway_variant_id?.trim(),
      currency: data.currency || 'USD'
    };
  }
}