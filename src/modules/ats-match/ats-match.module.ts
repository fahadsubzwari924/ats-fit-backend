import { Module, forwardRef } from '@nestjs/common';

import { AtsMatchController } from './ats-match.controller';
import { SharedModule } from '../../shared/shared.module';
import { ResumeTailoringModule } from '../resume-tailoring/resume-tailoring.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Resume, User, ExtractedResumeContent } from '../../database/entities';
import { ResumeSelectionService } from './services/resume-selection.service';

@Module({
  controllers: [AtsMatchController],
  providers: [ResumeSelectionService],
  imports: [
    SharedModule,
    forwardRef(() => ResumeTailoringModule),
    TypeOrmModule.forFeature([Resume, User, ExtractedResumeContent]),
  ],
  exports: [ResumeSelectionService],
})
export class AtsMatchModule {}
