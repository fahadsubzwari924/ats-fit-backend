import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3ServiceException,
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { BadRequestException } from '../../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../../shared/constants/error-codes';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_BUCKET_REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
      maxAttempts: 3, // Retry up to 3 times
    });
  }

  async uploadFile(params: {
    bucketName: string;
    key: string;
    file: Buffer;
    contentType?: string;
    metadata?: Record<string, string>;
  }): Promise<string> {
    const { bucketName, key, file, contentType, metadata } = params;

    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file,
        ContentType: contentType,
        Metadata: metadata,
      });

      await this.s3Client.send(command);
      this.logger.log(
        `File uploaded successfully to s3://${bucketName}/${key}`,
      );
      return key;
    } catch (error) {
      this.logger.error(
        `Failed to upload file to s3://${bucketName}/${key}`,
        error,
      );
      throw this.handleS3Error(error, 'upload');
    }
  }

  async getObject(params: {
    bucketName: string;
    key: string;
  }): Promise<Buffer> {
    const { bucketName, key } = params;

    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const stream = response.Body as Readable;

      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', (error) => {
          this.logger.error(
            `Error reading stream from s3://${bucketName}/${key}`,
            error,
          );
          reject(this.handleS3Error(error, 'read'));
        });
        stream.on('end', () => {
          this.logger.debug(
            `Successfully read file from s3://${bucketName}/${key}`,
          );
          resolve(Buffer.concat(chunks));
        });
      });
    } catch (error) {
      this.logger.error(
        `Failed to get object from s3://${bucketName}/${key}`,
        error,
      );
      throw this.handleS3Error(error, 'get');
    }
  }

  async getSignedUrl(params: {
    bucketName: string;
    key: string;
    expiresIn?: number;
  }): Promise<string> {
    const { bucketName, key, expiresIn = 3600 } = params;

    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      this.logger.debug(`Generated signed URL for s3://${bucketName}/${key}`);
      return url;
    } catch (error) {
      this.logger.error(
        `Failed to generate signed URL for s3://${bucketName}/${key}`,
        error,
      );
      throw this.handleS3Error(error, 'generate-url');
    }
  }

  async deleteObject(params: {
    bucketName: string;
    key: string;
  }): Promise<void> {
    const { bucketName, key } = params;

    try {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`Successfully deleted s3://${bucketName}/${key}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete object s3://${bucketName}/${key}`,
        error,
      );
      throw this.handleS3Error(error, 'delete');
    }
  }

  async objectExists(params: {
    bucketName: string;
    key: string;
  }): Promise<boolean> {
    const { bucketName, key } = params;

    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      this.logger.error(
        `Error checking existence of s3://${bucketName}/${key}`,
        error,
      );
      throw this.handleS3Error(error, 'check-existence');
    }
  }

  extractS3KeyFromUrl(s3Url: string): string {
    try {
      // Validate input
      if (!s3Url || typeof s3Url !== 'string') {
        throw new BadRequestException(
          'Invalid S3 URL provided',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Parse the URL
      const parsedUrl = new URL(s3Url);

      // Validate that it's an S3 URL
      if (
        !parsedUrl.hostname.includes('s3') ||
        !parsedUrl.hostname.includes('amazonaws.com')
      ) {
        throw new BadRequestException(
          'URL is not a valid S3 URL',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Extract the key (pathname without leading slash)
      const key = parsedUrl.pathname.slice(1);

      // Validate that we have a key
      if (!key) {
        throw new BadRequestException(
          'No S3 object key found in URL',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Decode URI components to handle special characters
      return decodeURIComponent(key);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Failed to extract S3 key from URL: ${s3Url}`, error);
      throw new BadRequestException(
        'Failed to parse S3 URL',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  private isS3ServiceException(error: unknown): error is S3ServiceException {
    return (
      error instanceof Error &&
      'name' in error &&
      'message' in error &&
      (error as S3ServiceException).$metadata !== undefined
    );
  }

  private handleS3Error(error: unknown, operation: string): Error {
    if (this.isS3ServiceException(error)) {
      switch (error.name) {
        case 'NoSuchBucket':
          return new Error(`S3 bucket not found during ${operation} operation`);
        case 'NoSuchKey':
          return new Error(`S3 object not found during ${operation} operation`);
        case 'AccessDenied':
          return new Error(
            `Access denied to S3 resource during ${operation} operation`,
          );
        default:
          return new Error(
            `S3 service error during ${operation}: ${error.message}`,
          );
      }
    }

    // Handle non-S3 errors
    if (error instanceof Error) {
      return new Error(
        `Unexpected error during S3 ${operation}: ${error.message}`,
      );
    }

    return new Error(`Unknown error occurred during S3 ${operation}`);
  }

  private isNotFoundError(error: any): boolean {
    return (
      error instanceof S3ServiceException &&
      (error?.name === 'NoSuchBucket' || error?.name === 'NoSuchKey')
    );
  }
}
