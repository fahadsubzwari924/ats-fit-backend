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
  QueueMessage,
  TailoringQuestion,
  EnrichedResumeProfile,
  BatchTailoringRun,
  BatchTailoringJob,
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
import { ResumeQueueService } from './services/resume-queue.service';
import { ResumeProfileEnrichmentService } from './services/resume-profile-enrichment.service';
import { ProfileQuestionSelectionService } from './services/profile-question-selection.service';
import { ProfileQuestionGenerationService } from './services/profile-question-generation.service';
import { CoverLetterGenerationService } from './services/cover-letter-generation.service';
import { CoverLetterPdfService } from './services/cover-letter-pdf.service';
import { TailoredResumePdfStorageService } from './services/tailored-resume-pdf-storage.service';
import { ProfileQuestionsController } from './controllers/profile-questions.controller';
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
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { JobRelevanceModule } from '../job-relevance/job-relevance.module';
import { RESUME_CONTENT_PROVIDER } from '../../shared/tokens/resume-content-provider.token';
import { ResumeExtractionProcessor } from './processors/resume-extraction.processor';
import { ResumeProfileEnrichmentProcessor } from './processors/resume-profile-enrichment.processor';
import { ChangesDiffProcessor } from './processors/changes-diff.processor';
import { ChangesDiffComputationService } from './services/changes-diff-computation.service';
import { AtsChecksComputationService } from './services/ats-checks-computation.service';
import { BulletsQuantifiedComputationService } from './services/bullets-quantified-computation.service';
import { BulletRelevanceScoringService } from './services/bullet-relevance-scoring.service';
import { ExperienceTechAllowlistService } from './services/experience-tech-allowlist.service';
import { PromptVariantResolverService } from './services/prompt-variant-resolver.service';
import { KeywordMatchScoringService } from './services/keyword-match-scoring.service';
import { MatchScoreClassifierService } from './services/match-score-classifier.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ResumeTemplate,
      User,
      ResumeGeneration,
      Resume,
      ExtractedResumeContent,
      QueueMessage,
      TailoringQuestion,
      EnrichedResumeProfile,
      BatchTailoringRun,
      BatchTailoringJob,
    ]),
    ConfigModule,
    SharedModule,
    ExternalModule,
    forwardRef(() => RateLimitModule),
    forwardRef(() => AtsMatchModule),
    forwardRef(() => QueueModule),
    forwardRef(() => AuthModule),
    forwardRef(() => JobRelevanceModule),
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
    TailoredResumePdfStorageService,
    ResumeGenerationOrchestratorService,
    ResumeQueueService,
    // Bullet scoring (shared by optimizer + question selection)
    BulletRelevanceScoringService,
    // Tech-substitution guardrail (paired with prompt EXPERIENCE_TECH_LOCK)
    ExperienceTechAllowlistService,
    // Profile enrichment & profile questions
    ProfileQuestionSelectionService,
    ProfileQuestionGenerationService,
    ResumeProfileEnrichmentService,
    // Cover Letter Generation
    CoverLetterGenerationService,
    CoverLetterPdfService,
    ResumeExtractionProcessor,
    ResumeProfileEnrichmentProcessor,
    ChangesDiffProcessor,
    ChangesDiffComputationService,
    AtsChecksComputationService,
    BulletsQuantifiedComputationService,
    PromptVariantResolverService,
    // Keyword match scoring (3-layer scorer used by orchestrator)
    KeywordMatchScoringService,
    // Match score classifier — BE-side derivation of the canonical
    // MatchScoreBlock (improvementKind, improvementMessage, statusColor).
    MatchScoreClassifierService,
    // Interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformUserContextInterceptor,
    },
  ],
  controllers: [ResumeTailoringController, ProfileQuestionsController],
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
    ResumeGenerationOrchestratorService,
    ResumeQueueService,
    ResumeProfileEnrichmentService,
    PromptVariantResolverService,
    KeywordMatchScoringService,
  ],
})
export class ResumeTailoringModule {}
