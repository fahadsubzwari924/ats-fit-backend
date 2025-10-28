import {
  BadRequestException,
  NotFoundException,
} from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

export class IdValidator {
  static validateId(id: any, fieldName: string = 'ID'): string {
    if (!id || (typeof id === 'string' && id.trim() === '')) {
      throw new BadRequestException(
        `${fieldName} is required`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return typeof id === 'string' ? id.trim() : String(id);
  }

  static validateAndThrowNotFound(
    entity: any,
    id: string,
    entityName: string,
  ): void {
    if (!entity) {
      throw new NotFoundException(
        `${entityName} with ID ${id} not found`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }
  }
}
