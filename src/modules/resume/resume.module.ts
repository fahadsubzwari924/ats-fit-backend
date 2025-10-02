import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResumeController } from './resume.controller';
import {
  ResumeGeneration,
  ResumeTemplate,
  User,
  Resume,
  ExtractedResumeContent,
} from '../../database/entities';
import { HandlebarsService } from '../../shared/services/handlebars.service';
import {
  GeneratePdfService,
  ResumeTemplateService,
  ResumeService,
  AIService,
  PromptService,
} from './services';
import { JobDescriptionAnalysisService } from './services/job-description-analysis.service';
import { ResumeContentProcessorService } from './services/resume-content-processor.service';
import { AIResumeOptimizerService } from './services/ai-resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './services/pdf-generation-orchestrator.service';
import { ResumeGenerationOrchestratorV2Service } from './services/resume-generation-orchestrator-v2.service';
import { ExtractedResumeService } from './services/extracted-resume.service';
import { ResumeValidationServiceV2 } from './services/resume-validation-v2.service';
import { BasicInputValidationRule } from './validation/basic-input-validation.rule';
import { UserContextValidationRule } from './validation/user-context-validation.rule';
import { TemplateValidationRule } from './validation/template-validation.rule';
import { FileValidationRule } from './validation/file-validation.rule';
import { ResumeRequirementsValidationRule } from './validation/resume-requirements-validation.rule';
import { TransformUserContextInterceptor } from '../../shared/interceptors/transform-user-context.interceptor';
import { SharedModule } from '../../shared/shared.module';
import { ExternalModule } from '../../shared/modules/external/external.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { AtsMatchModule } from '../ats-match/ats-match.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ResumeTemplate,
      User,
      ResumeGeneration,
      Resume,
      ExtractedResumeContent,
    ]),
    ConfigModule,
    SharedModule,
    ExternalModule,
    forwardRef(() => RateLimitModule),
    forwardRef(() => AtsMatchModule),
  ],
  providers: [
    ResumeService,
    HandlebarsService,
    ResumeTemplateService,
    GeneratePdfService,
    AIService,
    PromptService,
    ExtractedResumeService,
    // V2 Validation Services
    ResumeValidationServiceV2,
    BasicInputValidationRule,
    UserContextValidationRule,
    TemplateValidationRule,
    FileValidationRule,
    ResumeRequirementsValidationRule,
    // V2 Services
    JobDescriptionAnalysisService,
    ResumeContentProcessorService,
    AIResumeOptimizerService,
    PdfGenerationOrchestratorService,
    ResumeGenerationOrchestratorV2Service,
    // Interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformUserContextInterceptor,
    },
  ],
  controllers: [ResumeController],
  exports: [
    ResumeTemplateService,
    ResumeService,
    HandlebarsService,
    GeneratePdfService,
    AIService,
    ExtractedResumeService,
    // V2 Validation Services
    ResumeValidationServiceV2,
    // V2 Services
    JobDescriptionAnalysisService,
    ResumeContentProcessorService,
    AIResumeOptimizerService,
    PdfGenerationOrchestratorService,
  ],
})
export class ResumeModule {}
