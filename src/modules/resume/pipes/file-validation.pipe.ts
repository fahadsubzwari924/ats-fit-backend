import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

@Injectable()
export class FileValidationPipe implements PipeTransform {
  transform(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'Resume file is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate file type
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException(
        'Only PDF files are supported for resume upload',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate file size (5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate file has content
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        'Resume file is empty or corrupted',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return file;
  }
}
