import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

/**
 * Service responsible for managing extracted resume content operations
 * Follows Single Responsibility Principle - only handles extracted resume content
 */
@Injectable()
export class ExtractedResumeService {
  private readonly logger = new Logger(ExtractedResumeService.name);

  constructor(
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeRepository: Repository<ExtractedResumeContent>,
  ) {}

  /**
   * Check if user has a processed resume available
   * Note: Each user can only have one processed resume at a time
   */
  async hasProcessedResume(userId: string): Promise<boolean> {
    const count = await this.extractedResumeRepository
      .createQueryBuilder('resume')
      .where('resume.userId = :userId', { userId })
      .andWhere('resume.extractedText IS NOT NULL')
      .andWhere("resume.extractedText != ''")
      .getCount();
    return count > 0;
  }

  /**
   * Get the user's processed resume
   * Note: Each user can only have one processed resume at a time
   */
  async getUserProcessedResume(
    userId: string,
  ): Promise<ExtractedResumeContent | null> {
    const resume = await this.extractedResumeRepository
      .createQueryBuilder('resume')
      .where('resume.userId = :userId', { userId })
      .andWhere('resume.extractedText IS NOT NULL')
      .andWhere("resume.extractedText != ''")
      .getOne();

    if (resume) {
      // Update usage statistics
      resume.incrementUsageCount();
      await this.extractedResumeRepository.save(resume);

      this.logger.log(
        `Retrieved processed resume ${resume.id} for user ${userId}`,
      );
    }

    return resume;
  }

  /**
   * Check if user can use pre-processed resume feature
   */
  canUsePreProcessedResume(userType: string): boolean {
    return userType !== 'guest';
  }

  /**
   * Get user's processed resume info for display purposes
   * Returns basic info about the single processed resume
   */
  async getUserProcessedResumeInfo(userId: string): Promise<{
    id: string;
    createdAt: Date;
    lastUsedAt: Date;
    usageCount: number;
  } | null> {
    const resume = await this.extractedResumeRepository
      .createQueryBuilder('resume')
      .select([
        'resume.id',
        'resume.createdAt',
        'resume.lastUsedAt',
        'resume.usageCount',
      ])
      .where('resume.userId = :userId', { userId })
      .andWhere('resume.extractedText IS NOT NULL')
      .andWhere("resume.extractedText != ''")
      .getOne();

    return resume
      ? {
          id: resume.id,
          createdAt: resume.createdAt,
          lastUsedAt: resume.lastUsedAt,
          usageCount: resume.usageCount || 0,
        }
      : null;
  }

  /**
   * Get all extracted resumes for a user (with queue message details)
   * Note: Generally users have only one resume, but this supports historical data
   */
  async getUserExtractedResumes(
    userId: string,
  ): Promise<ExtractedResumeContent[]> {
    return this.extractedResumeRepository.find({
      where: { userId },
      relations: ['queueMessage'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get a specific extracted resume by ID and user ID
   * Updates usage statistics when accessed
   */
  async getUserExtractedResumeById(
    resumeId: string,
    userId: string,
  ): Promise<ExtractedResumeContent | null> {
    const resume = await this.extractedResumeRepository.findOne({
      where: { id: resumeId, userId },
      relations: ['queueMessage'],
    });

    if (resume) {
      // Update usage statistics
      resume.incrementUsageCount();
      await this.extractedResumeRepository.save(resume);

      this.logger.log(
        `Retrieved extracted resume ${resumeId} for user ${userId}`,
      );
    }

    return resume;
  }

  /**
   * Delete an extracted resume
   * Returns true if deleted, false if not found
   */
  async deleteExtractedResume(
    resumeId: string,
    userId: string,
  ): Promise<boolean> {
    const resume = await this.extractedResumeRepository.findOne({
      where: { id: resumeId, userId },
      relations: ['queueMessage'],
    });

    if (!resume) {
      this.logger.warn(
        `Attempted to delete non-existent resume ${resumeId} for user ${userId}`,
      );
      return false;
    }

    // Delete the extracted resume content
    await this.extractedResumeRepository.delete({ id: resumeId, userId });

    this.logger.log(`Deleted extracted resume ${resumeId} for user ${userId}`, {
      queueMessageId: resume.queueMessageId,
      originalFileName: resume.originalFileName,
    });

    return true;
  }

  /**
   * Create a new extracted resume content record
   * Used by queue processing system
   */
  async createExtractedResumeRecord(data: {
    userId: string;
    queueMessageId: string;
    originalFileName: string;
    fileSize: number;
    fileHash: string;
  }): Promise<ExtractedResumeContent> {
    const newRecord = this.extractedResumeRepository.create({
      userId: data.userId,
      queueMessageId: data.queueMessageId,
      originalFileName: data.originalFileName,
      fileSize: data.fileSize,
      fileHash: data.fileHash,
      extractedText: '', // Will be populated by the processor
      structuredContent: {} as TailoredContent, // Will be populated by the processor
      usageCount: 0,
    });

    const savedRecord = await this.extractedResumeRepository.save(newRecord);

    this.logger.log(
      `Created extracted resume record ${savedRecord.id} for user ${data.userId}`,
      {
        queueMessageId: data.queueMessageId,
        fileName: data.originalFileName,
        fileHash: data.fileHash,
      },
    );

    return savedRecord;
  }

  /**
   * Check if a file with the same hash already exists for the user
   * Helps prevent duplicate processing
   */
  async findExistingByFileHash(
    userId: string,
    fileHash: string,
  ): Promise<ExtractedResumeContent | null> {
    return this.extractedResumeRepository.findOne({
      where: { fileHash, userId },
    });
  }
}
