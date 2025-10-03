import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { Resume } from '../../database/entities/resume.entity';
import { QueueMessage } from '../../database/entities/queue-message.entity';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { ResumeContentService } from '../resume-tailoring/services/resume-content.service';
import { ResumeTailoringModule } from '../resume-tailoring/resume-tailoring.module';
import { AuthModule } from '../auth/auth.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Resume,
      QueueMessage,
      ExtractedResumeContent,
    ]),
    forwardRef(() => ResumeTailoringModule),
    forwardRef(() => AuthModule),
    forwardRef(() => RateLimitModule),
    QueueModule,
  ],
  controllers: [UserController],
  providers: [UserService, ResumeContentService],
  exports: [UserService],
})
export class UserModule {}
