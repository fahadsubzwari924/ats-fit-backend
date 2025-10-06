import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResumeTailoringController } from './resume-tailoring.controller';
import {
  ResumeGeneration,
  ResumeTemplate,
  User,
  Resume,
  ExtractedResumeContent,
} from '../../database/entities';
import { HandlebarsService } from '../../shared/services/handlebars.service';
import {
  ResumeTemplateService,
  ResumeService,
  PromptService,
} from './services';
import { PdfGenerationService } from './services/pdf-generation.service';
import { JobAnalysisService } from './services/job-analysis.service';
import { ResumeContentProcessorService } from './services/resume-content-processor.service';
import { ResumeOptimizerService } from './services/resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './services/pdf-generation-orchestrator.service';
import { ResumeGenerationOrchestratorService } from './services/resume-generation-orchestrator.service';
import { ResumeContentService } from './services/resume-content.service';
import { ResumeValidationService } from './services/resume-validation.service';
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
import { RESUME_CONTENT_PROVIDER } from '../../shared/tokens/resume-content-provider.token';

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
    PdfGenerationService,
    PromptService,
    ResumeContentService,
    // Interface Provider for Dependency Inversion
    {
      provide: RESUME_CONTENT_PROVIDER,
      useExisting: ResumeContentService,
    },
    // Validation Services
    ResumeValidationService,
    BasicInputValidationRule,
    UserContextValidationRule,
    TemplateValidationRule,
    FileValidationRule,
    ResumeRequirementsValidationRule,
    // V2 Services
    JobAnalysisService,
    ResumeContentProcessorService,
    ResumeOptimizerService,
    PdfGenerationOrchestratorService,
    ResumeGenerationOrchestratorService,
    // Interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformUserContextInterceptor,
    },
  ],
  controllers: [ResumeTailoringController],
  exports: [
    ResumeTemplateService,
    ResumeService,
    HandlebarsService,
    PdfGenerationService,
    ResumeContentService,
    // Interface Provider for cross-module usage
    RESUME_CONTENT_PROVIDER,
    // Validation Services
    ResumeValidationService,
    // Services
    JobAnalysisService,
    ResumeContentProcessorService,
    ResumeOptimizerService,
    PdfGenerationOrchestratorService,
  ],
})
export class ResumeTailoringModule {}
