import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { Resume } from '../../database/entities/resume.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { ResumeModule } from '../resume/resume.module';
import { AuthModule } from '../auth/auth.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Resume]),
    forwardRef(() => ResumeModule),
    forwardRef(() => AuthModule),
    forwardRef(() => RateLimitModule),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
