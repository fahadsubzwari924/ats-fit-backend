import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ResumeController } from './resume.controller';
import { ResumeTemplate } from '../../database/entities/resume-templates.entity';
import { User } from '../../database/entities/user.entity';
import { Resume } from '../../database/entities/resume.entity';
import { OpenAIService } from '../../external/services/open_ai.service';
import { HandlebarsService } from '../../shared/services/handlebars.service';
import { S3Service } from '../../external/services/s3.service';
import {
  GeneratePdfService,
  ResumeTemplateService,
  ResumeService,
  AIService,
  PromptService,
} from './services';
import { EmbeddingService } from '../../external/services/embedding.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResumeTemplate, User, Resume]),
    ConfigModule,
  ],
  providers: [
    ResumeService,
    OpenAIService,
    HandlebarsService,
    S3Service,
    ResumeTemplateService,
    GeneratePdfService,
    AIService,
    EmbeddingService,
    PromptService,
  ],
  controllers: [ResumeController],
  exports: [
    ResumeTemplateService,
    ResumeService,
    HandlebarsService,
    GeneratePdfService,
  ],
})
export class ResumeModule {}
