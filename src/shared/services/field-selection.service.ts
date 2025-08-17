import { Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';

export interface FieldSelectionConfig {
  entity: string; // Entity alias
  allowedFields: string[]; // List of allowed field names
  defaultFields?: string[]; // Default fields to select if none specified
  relations?: Record<string, FieldSelectionConfig>; // Nested relations
}

@Injectable()
export class FieldSelectionService {
  /**
   * Apply field selection to TypeORM query builder
   */
  applyFieldSelection<T>(
    queryBuilder: SelectQueryBuilder<T>,
    requestedFields: string[],
    config: FieldSelectionConfig,
  ): SelectQueryBuilder<T> {
    const fieldsToSelect = this.getValidatedFields(requestedFields, config);

    if (fieldsToSelect.length === 0) {
      return queryBuilder;
    }

    // Clear existing selections and add only requested fields
    queryBuilder.select([]);

    // Add main entity fields
    const mainFields = fieldsToSelect
      .filter((field) => !field.includes('.'))
      .map((field) => `${config.entity}.${field}`);

    if (mainFields.length > 0) {
      queryBuilder.addSelect(mainFields);
    }

    // Add relation fields
    const relationFields = fieldsToSelect.filter((field) =>
      field.includes('.'),
    );
    for (const relationField of relationFields) {
      const [relation, field] = relationField.split('.');
      if (config.relations?.[relation]) {
        queryBuilder.addSelect(`${relation}.${field}`);
      }
    }

    return queryBuilder;
  }

  /**
   * Filter response object to include only selected fields
   */
  filterResponseFields<T>(
    data: T | T[],
    requestedFields: string[],
    config: FieldSelectionConfig,
  ): Partial<T> | Partial<T>[] {
    if (!requestedFields || requestedFields.length === 0) {
      return data;
    }

    const fieldsToInclude = this.getValidatedFields(requestedFields, config);

    if (fieldsToInclude.length === 0) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.filterSingleObject(item, fieldsToInclude));
    }

    return this.filterSingleObject(data, fieldsToInclude);
  }

  /**
   * Get TypeORM select fields for query optimization
   */
  getSelectFields(
    requestedFields: string[],
    config: FieldSelectionConfig,
  ): string[] {
    const validatedFields = this.getValidatedFields(requestedFields, config);

    if (validatedFields.length === 0) {
      return config.defaultFields || [];
    }

    return validatedFields.map((field) => {
      if (field.includes('.')) {
        return field; // Relation field
      }
      return `${config.entity}.${field}`;
    });
  }

  /**
   * Validate and filter requested fields against allowed fields
   */
  private getValidatedFields(
    requestedFields: string[],
    config: FieldSelectionConfig,
  ): string[] {
    if (!requestedFields || requestedFields.length === 0) {
      return config.defaultFields || [];
    }

    const validFields: string[] = [];

    for (const field of requestedFields) {
      if (field.includes('.')) {
        // Handle relation fields
        const [relation, relationField] = field.split('.');
        if (
          config.relations?.[relation] &&
          config.relations[relation].allowedFields.includes(relationField)
        ) {
          validFields.push(field);
        }
      } else if (config.allowedFields.includes(field)) {
        // Handle main entity fields
        validFields.push(field);
      }
    }

    return validFields;
  }

  /**
   * Filter a single object to include only specified fields
   */
  private filterSingleObject<T>(obj: T, fieldsToInclude: string[]): Partial<T> {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const filtered: Partial<T> = {};

    for (const field of fieldsToInclude) {
      if (field.includes('.')) {
        // Handle nested fields
        const [parentField, childField] = field.split('.');
        if (
          obj[parentField as keyof T] &&
          typeof obj[parentField as keyof T] === 'object'
        ) {
          if (!filtered[parentField as keyof T]) {
            filtered[parentField as keyof T] = {} as T[keyof T];
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          (filtered[parentField as keyof T] as any)[childField] =
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            (obj[parentField as keyof T] as any)?.[childField];
        }
      } else if (field in obj) {
        filtered[field as keyof T] = obj[field as keyof T];
      }
    }

    return filtered;
  }
}
