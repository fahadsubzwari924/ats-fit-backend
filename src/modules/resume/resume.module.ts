import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ResumeController } from './resume.controller';
import {
  ResumeGeneration,
  ResumeTemplate,
  User,
} from '../../database/entities';
import { HandlebarsService } from '../../shared/services/handlebars.service';
import {
  GeneratePdfService,
  ResumeTemplateService,
  ResumeService,
  AIService,
  PromptService,
} from './services';
import { SharedModule } from '../../shared/shared.module';
import { ExternalModule } from '../../shared/modules/external/external.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResumeTemplate, User, ResumeGeneration]),
    ConfigModule,
    SharedModule,
    ExternalModule,
    RateLimitModule,
  ],
  providers: [
    ResumeService,
    HandlebarsService,
    ResumeTemplateService,
    GeneratePdfService,
    AIService,
    PromptService,
  ],
  controllers: [ResumeController],
  exports: [
    ResumeTemplateService,
    ResumeService,
    HandlebarsService,
    GeneratePdfService,
    AIService,
  ],
})
export class ResumeModule {}
