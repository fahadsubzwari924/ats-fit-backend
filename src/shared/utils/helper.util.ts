export class HelperUtil {
  /**
   * Validates if a value exists in an enum, otherwise returns the default value.
   * @param enumType The enum to validate against.
   * @param value The value to validate.
   * @param defaultValue The default value to return if validation fails.
   * @returns The validated enum value or the default value.
   */
  static validateEnumValue<T>(
    enumType: T,
    value: string,
    defaultValue: T[keyof T],
  ): T[keyof T] {
    return Object.values(enumType).includes(value as T[keyof T])
      ? (value as T[keyof T])
      : defaultValue;
  }
}
