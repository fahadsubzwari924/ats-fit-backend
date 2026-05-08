import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { Resume } from '../../database/entities/resume.entity';
import { S3Service } from '../modules/external/services/s3.service';
import { RESUME_REPLACEMENT } from '../constants/resume-replacement.constants';

// NOTE: @Cron scheduling requires @nestjs/schedule package.
// Wire `ScheduleModule.forRoot()` in AppModule and add the @Cron decorator
// when the package is installed:
//
//   import { Cron, CronExpression } from '@nestjs/schedule';
//   @Cron(CronExpression.EVERY_DAY_AT_3AM)
//   async purgeOldArchives(): Promise<void> { ... }

@Injectable()
export class ArchivePurgeService {
  private readonly logger = new Logger(ArchivePurgeService.name);

  constructor(
    @InjectRepository(ExtractedResumeContent)
    private readonly extractRepo: Repository<ExtractedResumeContent>,
    @InjectRepository(Resume)
    private readonly resumeRepo: Repository<Resume>,
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService,
  ) {}

  async purgeOldArchives(): Promise<void> {
    const cutoff = new Date(
      Date.now() -
        RESUME_REPLACEMENT.ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const oldExtracts = await this.extractRepo.find({
      where: { isActive: false, archivedAt: LessThan(cutoff) },
    });
    if (oldExtracts.length > 0) {
      await this.extractRepo.remove(oldExtracts);
      this.logger.log(
        `Purged ${oldExtracts.length} archived extracts older than ${RESUME_REPLACEMENT.ARCHIVE_RETENTION_DAYS} days.`,
      );
    }

    const oldResumes = await this.resumeRepo.find({
      where: { isActive: false, archivedAt: LessThan(cutoff) },
    });

    const bucketName = this.configService.get<string>(
      'AWS_S3_CANDIDATES_RESUMES_BUCKET',
    );
    for (const r of oldResumes) {
      try {
        const s3Key = this.s3Service.extractS3KeyFromUrl(r.s3Url);
        await this.s3Service.deleteObject({ bucketName, key: s3Key });
      } catch (e) {
        this.logger.warn(`Failed to delete S3 object for resume ${r.id}`, e);
      }
    }
    if (oldResumes.length > 0) {
      await this.resumeRepo.remove(oldResumes);
      this.logger.log(`Purged ${oldResumes.length} archived resumes.`);
    }
  }
}
