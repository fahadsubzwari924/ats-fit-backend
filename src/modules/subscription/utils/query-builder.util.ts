import { FindManyOptions } from 'typeorm';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import {
  ISubscriptionPlanQueryOptions,
  ISubscriptionPlanWhereClause,
  ISubscriptionPlanOrderBy,
  DEFAULT_SUBSCRIPTION_PLAN_QUERY,
} from '../interfaces/query.interface';
import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

/**
 * Query builder utility for subscription plan queries
 * Follows Single Responsibility Principle and provides reusable query building logic
 */
export class SubscriptionPlanQueryBuilder {
  /**
   * Build TypeORM FindManyOptions from query parameters
   * @param options Query options with defaults applied
   * @returns TypeORM FindManyOptions
   */
  static buildFindOptions(
    options: ISubscriptionPlanQueryOptions,
  ): FindManyOptions<SubscriptionPlan> {
    const mergedOptions = this.mergeWithDefaults(options);

    return {
      where: this.buildWhereClause(mergedOptions.where!),
      order: this.buildOrderClause(mergedOptions.orderBy!),
    };
  }

  /**
   * Merge provided options with defaults
   * @param options User-provided query options
   * @returns Complete options with defaults applied
   */
  private static mergeWithDefaults(
    options: ISubscriptionPlanQueryOptions,
  ): Required<ISubscriptionPlanQueryOptions> {
    return {
      where: {
        ...DEFAULT_SUBSCRIPTION_PLAN_QUERY.where,
        ...options.where,
      },
      orderBy: options.orderBy || DEFAULT_SUBSCRIPTION_PLAN_QUERY.orderBy,
      includeInactive:
        options.includeInactive ??
        DEFAULT_SUBSCRIPTION_PLAN_QUERY.includeInactive,
    };
  }

  /**
   * Build where clause with validation
   * @param whereClause Where clause parameters
   * @returns Validated where clause
   */
  private static buildWhereClause(
    whereClause: ISubscriptionPlanWhereClause,
  ): ISubscriptionPlanWhereClause {
    const validatedWhere = { ...whereClause };

    // Validate price if provided
    if (validatedWhere.price !== undefined) {
      if (
        typeof validatedWhere.price !== 'number' ||
        validatedWhere.price < 0
      ) {
        throw new BadRequestException(
          'Price must be a non-negative number',
          ERROR_CODES.BAD_REQUEST,
        );
      }
    }

    // Validate name if provided
    if (validatedWhere.name !== undefined) {
      if (
        typeof validatedWhere.name !== 'string' ||
        validatedWhere.name.trim().length === 0
      ) {
        throw new BadRequestException(
          'Name must be a non-empty string',
          ERROR_CODES.BAD_REQUEST,
        );
      }
      validatedWhere.name = validatedWhere.name.trim();
    }

    // Validate payment_gateway_variant_id if provided
    if (validatedWhere.payment_gateway_variant_id !== undefined) {
      if (
        typeof validatedWhere.payment_gateway_variant_id !==
          'string' ||
        validatedWhere.payment_gateway_variant_id.trim().length === 0
      ) {
        throw new BadRequestException(
          'Payment gateway variant ID must be a non-empty string',
          ERROR_CODES.BAD_REQUEST,
        );
      }
      validatedWhere.payment_gateway_variant_id =
        validatedWhere.payment_gateway_variant_id.trim();
    }

    return validatedWhere;
  }

  /**
   * Build order clause with validation
   * @param orderBy Order parameters
   * @returns TypeORM order object
   */
  private static buildOrderClause(
    orderBy: ISubscriptionPlanOrderBy,
  ): Record<string, 'ASC' | 'DESC'> {
    // Validate order direction
    if (!['ASC', 'DESC'].includes(orderBy.direction)) {
      throw new BadRequestException(
        'Order direction must be either ASC or DESC',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return {
      [orderBy.field]: orderBy.direction,
    };
  }

  /**
   * Validate query options before processing
   * @param options Query options to validate
   */
  static validateQueryOptions(options: ISubscriptionPlanQueryOptions): void {
    if (!options || typeof options !== 'object') {
      throw new BadRequestException(
        'Query options must be a valid object',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate where clause if provided
    if (
      options.where !== undefined &&
      (typeof options.where !== 'object' || options.where === null)
    ) {
      throw new BadRequestException(
        'Where clause must be a valid object',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate order by if provided
    if (options.orderBy !== undefined) {
      if (typeof options.orderBy !== 'object' || options.orderBy === null) {
        throw new BadRequestException(
          'Order by must be a valid object',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      if (!options.orderBy.field || !options.orderBy.direction) {
        throw new BadRequestException(
          'Order by must contain both field and direction properties',
          ERROR_CODES.BAD_REQUEST,
        );
      }
    }
  }
}
