import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Decorator to extract field selection from query parameters
 * Usage: @SelectFields() fields: string[]
 */
export const SelectFields = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string[] => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const fieldsParam = request.query.fields as string;

    if (!fieldsParam) {
      return [];
    }

    // Split by comma and trim whitespace
    return fieldsParam
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
  },
);
