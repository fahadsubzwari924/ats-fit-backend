import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const BETA_CODE_REGEX = /^BETA-[A-Z2-9]{8}$/;

@ValidatorConstraint({ name: 'isBetaCodeFormat', async: false })
export class IsBetaCodeFormatConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    return BETA_CODE_REGEX.test(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Code must follow the format BETA-XXXXXXXX (8 uppercase Crockford base32 characters)';
  }
}

export function IsBetaCodeFormat(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsBetaCodeFormatConstraint,
    });
  };
}
