import { Module, forwardRef } from '@nestjs/common';

import { ResumeService } from '../resume-tailoring/services/resume.service';
import { AtsMatchController } from './ats-match.controller';
import { AtsMatchService } from './ats-match.service';
import { SharedModule } from '../../shared/shared.module';
import { OpenAIService } from '../../shared/modules/external/services/open_ai.service';
import { EmbeddingService } from '../../shared/modules/external/services/embedding.service';
import { ClaudeService } from '../../shared/modules/external/services/claude.service';
import { ResumeTailoringModule } from '../resume-tailoring/resume-tailoring.module';
import { S3Service } from '../../shared/modules/external/services/s3.service';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { QueueModule } from '../queue/queue.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AtsMatchHistory } from '../../database/entities/ats-match-history.entity';
import { ResumeGeneration } from '../../database/entities/resume-generations.entity';
import { Resume, User, ExtractedResumeContent } from '../../database/entities';
import { AtsMatchHistoryService } from './ats-match-history.service';
import { ResumeSelectionService } from './services/resume-selection.service';

@Module({
  controllers: [AtsMatchController],
  providers: [
    AtsMatchService,
    ResumeService,
    OpenAIService,
    EmbeddingService,
    ClaudeService,
    S3Service,
    AtsMatchHistoryService,
    ResumeSelectionService,
  ],
  imports: [
    SharedModule,
    forwardRef(() => ResumeTailoringModule),
    forwardRef(() => RateLimitModule),
    forwardRef(() => QueueModule),
    TypeOrmModule.forFeature([
      AtsMatchHistory,
      ResumeGeneration,
      Resume,
      User,
      ExtractedResumeContent,
    ]),
  ],
  exports: [AtsMatchService, ResumeSelectionService],
})
export class AtsMatchModule {}
