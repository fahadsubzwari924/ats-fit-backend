import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobApplicationController } from './job-application.controller';
import { JobApplicationInterviewController } from './controllers/job-application-interview.controller';
import { JobApplicationService } from './job-application.service';
import { JobApplicationInterviewService } from './services/job-application-interview.service';
import { JobApplication } from '../../database/entities/job-application.entity';
import { JobApplicationInterview } from '../../database/entities/job-application-interview.entity';
import { ResumeGeneration } from '../../database/entities/resume-generations.entity';
import { User } from '../../database/entities/user.entity';
import { SharedModule } from '../../shared/shared.module';
import { FieldSelectionService } from '../../shared/services/field-selection.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JobApplication,
      JobApplicationInterview,
      ResumeGeneration,
      User,
    ]),
    SharedModule,
  ],
  controllers: [JobApplicationController, JobApplicationInterviewController],
  providers: [
    JobApplicationService,
    JobApplicationInterviewService,
    FieldSelectionService,
  ],
  exports: [JobApplicationService, JobApplicationInterviewService],
})
export class JobApplicationModule {}
