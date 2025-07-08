import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ResumeController } from './resume.controller';
import { ResumeTemplate } from '../../database/entities/resume-templates.entity';
import { User } from '../../database/entities/user.entity';
import { Resume } from '../../database/entities/resume.entity';
import { HandlebarsService } from '../../shared/services/handlebars.service';
import {
  GeneratePdfService,
  ResumeTemplateService,
  ResumeService,
  AIService,
  PromptService,
} from './services';
import { SharedModule } from '../../shared/shared.module';
import { ExternalModule } from 'src/shared/modules/external/external.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResumeTemplate, User, Resume]),
    ConfigModule,
    SharedModule,
    ExternalModule
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
