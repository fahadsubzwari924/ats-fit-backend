import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ResumeGenerationResult } from '../../../database/entities/resume-generation-result.entity';
import { ResumeGenerationResult as ResultData } from '../interfaces/resume-generation.interface';
import {
  NotFoundException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

/**
 * Resume Generation Result Service
 *
 * Following Single Responsibility Principle:
 * - Manages storage and retrieval of resume generation results
 * - Handles PDF content (base64 or S3 URL)
 * - Auto-cleanup of expired results
 * - Provides result access with ownership validation
 *
 * This service is separated from queue management to maintain
 * clean separation of concerns.
 */
@Injectable()
export class ResumeGenerationResultService {
  private readonly logger = new Logger(ResumeGenerationResultService.name);

  constructor(
    @InjectRepository(ResumeGenerationResult)
    private readonly resultRepository: Repository<ResumeGenerationResult>,
  ) {}

  /**
   * Save resume generation result
   * Stores the complete result including PDF content and metadata
   */
  async saveResult(
    queueMessageId: string,
    userId: string | undefined,
    guestId: string | undefined,
    orchestratorResult: ResultData,
    pdfContent: string, // base64 encoded
  ): Promise<ResumeGenerationResult> {
    try {
      const result = this.resultRepository.create({
        queueMessageId,
        userId: userId || null,
        guestId: guestId || null,
        pdfContent,
        filename: orchestratorResult.filename,
        fileSizeBytes: orchestratorResult.pdfSizeBytes,
        resumeGenerationId: orchestratorResult.resumeGenerationId,
        atsScore: orchestratorResult.atsScore,
        atsConfidence: orchestratorResult.atsConfidence,
        atsMatchHistoryId: orchestratorResult.atsMatchHistoryId,
        templateId: orchestratorResult.templateUsed,
        companyName: 'Unknown', // Will be set from job data
        jobPosition: 'Unknown', // Will be set from job data
        keywordsAdded: orchestratorResult.keywordsAdded,
        sectionsOptimized: orchestratorResult.sectionsOptimized,
        optimizationConfidence: orchestratorResult.optimizationConfidence,
        processingMetrics: orchestratorResult.processingMetrics,
      });

      const savedResult = await this.resultRepository.save(result);

      this.logger.log(
        `Saved resume generation result: ${savedResult.id} for queue message: ${queueMessageId}`,
      );

      return savedResult;
    } catch (error) {
      this.logger.error(
        `Failed to save resume generation result for queue message: ${queueMessageId}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to save resume generation result',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Update result with company and job details
   * Called after result is saved to add context from job data
   */
  async updateResultContext(
    resultId: string,
    companyName: string,
    jobPosition: string,
  ): Promise<void> {
    try {
      await this.resultRepository.update(resultId, {
        companyName,
        jobPosition,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to update result context for result: ${resultId}`,
        error,
      );
      // Non-critical, don't throw
    }
  }

  /**
   * Get result by queue message ID
   * Used to retrieve result when job is completed
   */
  async getResultByQueueMessageId(
    queueMessageId: string,
  ): Promise<ResumeGenerationResult | null> {
    try {
      return await this.resultRepository.findOne({
        where: { queueMessageId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get result for queue message: ${queueMessageId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get result by ID with ownership validation
   * Ensures user owns the result before returning
   */
  async getResultById(
    resultId: string,
    userId?: string,
    guestId?: string,
  ): Promise<ResumeGenerationResult> {
    try {
      const result = await this.resultRepository.findOne({
        where: { id: resultId },
      });

      if (!result) {
        throw new NotFoundException(
          'Resume generation result not found',
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Validate ownership
      const isOwner =
        (userId && result.userId === userId) ||
        (guestId && result.guestId === guestId);

      if (!isOwner) {
        throw new NotFoundException(
          'Resume generation result not found',
          ERROR_CODES.NOT_FOUND,
        );
      }

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to get result by ID: ${resultId}`, error);
      throw new InternalServerErrorException(
        'Failed to retrieve resume generation result',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Get PDF content from result
   * Returns base64 encoded PDF or downloads from S3 URL
   */
  async getPdfContent(resultId: string): Promise<Buffer> {
    try {
      const result = await this.resultRepository.findOne({
        where: { id: resultId },
      });

      if (!result) {
        throw new NotFoundException(
          'Resume generation result not found',
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (result.pdfContent) {
        // Return base64 decoded content
        return Buffer.from(result.pdfContent, 'base64');
      }

      if (result.pdfUrl) {
        // TODO: Download from S3 if using cloud storage
        throw new InternalServerErrorException(
          'S3 download not yet implemented',
          ERROR_CODES.INTERNAL_SERVER,
        );
      }

      throw new NotFoundException(
        'PDF content not found',
        ERROR_CODES.NOT_FOUND,
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(
        `Failed to get PDF content for result: ${resultId}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve PDF content',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Get user's recent results
   * Used for user dashboard or history
   */
  async getUserResults(
    userId: string,
    limit: number = 10,
  ): Promise<ResumeGenerationResult[]> {
    try {
      return await this.resultRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: limit,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get user results for user: ${userId}`,
        error,
      );
      return [];
    }
  }

  /**
   * Delete result by ID
   * Used for manual cleanup or user request
   */
  async deleteResult(resultId: string): Promise<void> {
    try {
      await this.resultRepository.delete({ id: resultId });
      this.logger.log(`Deleted resume generation result: ${resultId}`);
    } catch (error) {
      this.logger.error(`Failed to delete result: ${resultId}`, error);
      throw new InternalServerErrorException(
        'Failed to delete resume generation result',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Cleanup expired results
   * Runs daily to remove expired PDFs
   * Can be triggered manually via admin endpoint
   */
  async cleanupExpiredResults(): Promise<void> {
    try {
      const now = new Date();
      const result = await this.resultRepository.delete({
        expiresAt: LessThan(now),
      });

      const deletedCount =
        typeof result.affected === 'number' ? result.affected : 0;

      if (deletedCount > 0) {
        this.logger.log(
          `Cleaned up ${deletedCount} expired resume generation results`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired results', error);
    }
  }

  /**
   * Get storage statistics
   * Useful for monitoring and capacity planning
   */
  async getStorageStats(): Promise<{
    totalResults: number;
    totalSizeBytes: number;
    expiringToday: number;
  }> {
    try {
      const totalResults = await this.resultRepository.count();

      const stats = await this.resultRepository
        .createQueryBuilder('result')
        .select('SUM(result.file_size_bytes)', 'totalSize')
        .getRawOne<{ totalSize: string }>();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const expiringToday = await this.resultRepository.count({
        where: {
          expiresAt: LessThan(tomorrow),
        },
      });

      return {
        totalResults,
        totalSizeBytes: parseInt(stats?.totalSize || '0', 10),
        expiringToday,
      };
    } catch (error) {
      this.logger.error('Failed to get storage stats', error);
      return {
        totalResults: 0,
        totalSizeBytes: 0,
        expiringToday: 0,
      };
    }
  }
}
