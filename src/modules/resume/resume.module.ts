import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ResumeService } from './resume.service';
import { ResumeController } from './resume.controller';
import { ResumeTemplate } from 'src/database/entities/resume-templates.entity';
import { User } from 'src/database/entities/user.entity';
import { Resume } from 'src/database/entities/resume.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResumeTemplate, User, Resume]),
    ConfigModule,
  ],
  providers: [ResumeService],
  controllers: [ResumeController],
})
export class ResumeModule {}
