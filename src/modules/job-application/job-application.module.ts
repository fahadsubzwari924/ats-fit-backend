import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobApplicationController } from './job-application.controller';
import { JobApplicationService } from './job-application.service';
import { JobApplication } from '../../database/entities/job-application.entity';
import { AtsMatchHistory } from '../../database/entities/ats-match-history.entity';
import { ResumeGeneration } from '../../database/entities/resume-generations.entity';
import { User } from '../../database/entities/user.entity';
import { AtsMatchModule } from '../ats-match/ats-match.module';
import { SharedModule } from '../../shared/shared.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { FieldSelectionService } from '../../shared/services/field-selection.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JobApplication,
      AtsMatchHistory,
      ResumeGeneration,
      User,
    ]),
    AtsMatchModule,
    SharedModule,
    RateLimitModule,
  ],
  controllers: [JobApplicationController],
  providers: [JobApplicationService, FieldSelectionService],
  exports: [JobApplicationService],
})
export class JobApplicationModule {}
