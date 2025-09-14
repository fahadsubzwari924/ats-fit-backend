import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { Resume } from '../../database/entities/resume.entity';
import { QueueMessage } from '../../database/entities/queue-message.entity';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { ExtractedResumeService } from '../resume/services/extracted-resume.service';
import { ResumeModule } from '../resume/resume.module';
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
    forwardRef(() => ResumeModule),
    forwardRef(() => AuthModule),
    forwardRef(() => RateLimitModule),
    QueueModule,
  ],
  controllers: [UserController],
  providers: [UserService, ExtractedResumeService],
  exports: [UserService],
})
export class UserModule {}
