import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

@Injectable()
export class FileValidationPipe implements PipeTransform {
  transform(
    file: Express.Multer.File | undefined,
  ): Express.Multer.File | undefined {
    // If no file provided, return undefined (let business logic handle requirements)
    if (!file) {
      return undefined;
    }

    // If file is provided, perform full validation
    this.validateFileType(file);
    this.validateFileSize(file);
    this.validateFileContent(file);

    return file;
  }

  private validateFileType(file: Express.Multer.File): void {
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException(
        'Only PDF files are supported for resume upload',
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }
  }

  private validateFileSize(file: Express.Multer.File): void {
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`,
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  private validateFileContent(file: Express.Multer.File): void {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        'Resume file is empty or corrupted',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }
}
