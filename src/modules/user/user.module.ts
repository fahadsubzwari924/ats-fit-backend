import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { Resume } from '../../database/entities/resume.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { ResumeModule } from '../resume/resume.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Resume]),
    forwardRef(() => ResumeModule),
    AuthModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
