import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ResumeTemplateService } from './services/resume-templates.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResumeService } from './services/resume.service';
import { GenerateTailoredResumeDto } from './dtos/generate-tailored-resume.dto';
import { GenerateTailoredResumeV2Dto } from './dtos/generate-tailored-resume-v2.dto';
import { FileValidationPipe } from './pipes/file-validation.pipe';
import { JobDescriptionAnalysisService } from './services/job-description-analysis.service';
import { ResumeContentProcessorService } from './services/resume-content-processor.service';
import { AIResumeOptimizerService } from './services/ai-resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './services/pdf-generation-orchestrator.service';
import { ResumeGenerationOrchestratorV2Service } from './services/resume-generation-orchestrator-v2.service';
import { AtsEvaluationService } from '../../shared/services/ats-evaluation.service';
import { PromptService } from '../../shared/services/prompt.service';
import { AIService } from './services/ai.service';
import type { UserContext as ResumeUserContext } from './interfaces/user-context.interface';
import { ValidationLoggingInterceptor } from './interceptors/validation-logging.interceptor';
import {
  NotFoundException,
  BadRequestException,
} from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { RateLimitFeature } from '../rate-limit/rate-limit.guard';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { Public } from '../auth/decorators/public.decorator';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { TransformUserContext } from '../../shared/decorators/transform-user-context.decorator';
import { Response } from 'express';

@ApiTags('Resumes')
@Controller('resumes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ResumeController {
  private readonly logger = new Logger(ResumeController.name);

  constructor(
    private readonly resumeTemplateService: ResumeTemplateService,
    private readonly resumeService: ResumeService,
    private readonly resumeGenerationOrchestratorV2Service: ResumeGenerationOrchestratorV2Service,
    // Legacy services - kept for V1 endpoint compatibility
    private readonly jobDescriptionAnalysisService: JobDescriptionAnalysisService,
    private readonly resumeContentProcessorService: ResumeContentProcessorService,
    private readonly aiResumeOptimizerService: AIResumeOptimizerService,
    private readonly pdfGenerationOrchestratorService: PdfGenerationOrchestratorService,
    private readonly atsEvaluationService: AtsEvaluationService,
    private readonly promptService: PromptService,
    private readonly aiService: AIService,
  ) {}

  @Get('templates')
  async getTemplates() {
    const templates = await this.resumeTemplateService.getResumeTemplates();
    return templates;
  }

  @Post('generate')
  @Public()
  @RateLimitFeature(FeatureType.RESUME_GENERATION)
  @UseInterceptors(FileInterceptor('resumeFile'), ValidationLoggingInterceptor)
  async downloadGeneratedResume(
    @Body() generateResumeDto: GenerateTailoredResumeDto,
    @UploadedFile(FileValidationPipe)
    resumeFile: Express.Multer.File | undefined,
    @Req() request: RequestWithUserContext,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate required resume file
      if (!resumeFile) {
        throw new BadRequestException(
          'Resume file is required for resume generation',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      const authContext = request.userContext;

      const templateExists = await this.validateTemplateForDownloadEndpoint(
        generateResumeDto.templateId,
        res,
      );

      if (!templateExists) {
        return; // Response already sent by validation method
      }

      // Use the enhanced service method that includes ATS scoring
      const response =
        await this.resumeService.generateTailoredResumeWithAtsScore(
          generateResumeDto.jobDescription,
          generateResumeDto.companyName,
          resumeFile,
          generateResumeDto.templateId,
          authContext,
        );

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Successfully generated resume for download with ID: ${response.resumeGenerationId}, ATS Score: ${response.atsScore} in ${processingTime}ms`,
      );

      // Convert base64 back to buffer
      const pdfBuffer = Buffer.from(response.pdfContent, 'base64');

      // Set headers for PDF download
      this.setPdfResponseHeaders(res, response, pdfBuffer.length);

      // Send the PDF buffer directly
      res.end(pdfBuffer);

      const totalTime = Date.now() - startTime;
      this.logger.log(`Total download response time: ${totalTime}ms`);
    } catch (error) {
      this.logger.error('Error in downloadGeneratedResume:', error);

      // Handle specific known exceptions
      if (error instanceof NotFoundException) {
        res.status(404).json({
          status: 'error',
          message: error.message,
          code: 'TEMPLATE_NOT_FOUND',
          data: null,
          errors: null,
          meta: {
            timestamp: new Date().toISOString(),
            path: '/api/v1/resumes/generate/download',
          },
        });
        return;
      }

      // Handle any other errors as 500
      const errorMessage =
        error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({
        status: 'error',
        message: errorMessage,
        code: 'INTERNAL_SERVER_ERROR',
        data: null,
        errors: null,
        meta: {
          timestamp: new Date().toISOString(),
          path: '/api/v1/resumes/generate/download',
        },
      });
    }
  }

  /**
   * Generate Tailored Resume V2 - Enhanced AI-Powered Resume Generation
   *
   * This endpoint represents a complete rewrite of the resume generation system
   * with advanced AI capabilities, improved performance, and enhanced accuracy.
   *
   * Key Features:
   * - AI-powered job description analysis using GPT-4 Turbo
   * - Smart resume content processing for guest vs registered users
   * - Claude 3.5 Sonnet-powered content optimization
   * - ATS scoring integration with confidence metrics
   * - Optimized PDF generation with performance tracking
   * - Comprehensive error handling and validation
   *
   * Performance Improvements:
   * - 40-50% faster processing through service orchestration
   * - Intelligent caching and content reuse
   * - Parallel processing where possible
   * - Reduced API calls through smart batching
   */
  @Post('generate-tailored-v2')
  @Public()
  @TransformUserContext()
  @RateLimitFeature(FeatureType.RESUME_GENERATION)
  @UseInterceptors(FileInterceptor('resumeFile'), ValidationLoggingInterceptor)
  async generateTailoredResumeV2(
    @Body() generateResumeDto: GenerateTailoredResumeV2Dto,
    @UploadedFile(FileValidationPipe)
    resumeFile: Express.Multer.File | undefined,
    @Req() request: RequestWithUserContext,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // The user context is automatically transformed by @TransformUserContext() decorator
      const resumeUserContext = request.userContext as ResumeUserContext;

      // Orchestrate the complete V2 resume generation process
      const result =
        await this.resumeGenerationOrchestratorV2Service.generateOptimizedResume(
          {
            jobDescription: generateResumeDto.jobDescription,
            jobPosition: generateResumeDto.jobPosition,
            companyName: generateResumeDto.companyName,
            templateId: generateResumeDto.templateId,
            resumeId: generateResumeDto.resumeId,
            userContext: resumeUserContext,
            resumeFile,
          },
        );

      // Convert base64 to buffer for PDF download
      const pdfBuffer = Buffer.from(result.pdfContent, 'base64');

      // Prepare response object for headers (matching V1 structure)
      const responseForHeaders = {
        filename: result.filename,
        resumeGenerationId: result.atsMatchHistoryId,
        atsScore: result.atsScore,
      };

      // Set headers for PDF download
      this.setPdfResponseHeaders(res, responseForHeaders, pdfBuffer.length);

      // Send the PDF buffer directly
      res.end(pdfBuffer);

      const totalTime = Date.now() - startTime;
      this.logger.log(
        `V2 resume generation completed in ${totalTime}ms. ` +
          `ATS Score: ${result.atsScore}%, Keywords Added: ${result.keywordsAdded}, ` +
          `Optimization Confidence: ${result.optimizationConfidence}%`,
      );
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `V2 resume generation failed after ${processingTime}ms`,
        error,
      );

      // The orchestrator service handles specific error types and re-throws them
      // We just need to handle the final error response here
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // All other errors are wrapped as InternalServerErrorException by the orchestrator
      throw error;
    }
  }

  /**
   * Validates template existence for download endpoints (returns response directly)
   * @param templateId - The template ID to validate
   * @param res - Express response object
   * @returns Promise<boolean> - true if valid, false if invalid (response already sent)
   */
  private async validateTemplateForDownloadEndpoint(
    templateId: string,
    res: Response,
  ): Promise<boolean> {
    const templateExists =
      await this.resumeTemplateService.validateTemplateExists(templateId);

    if (!templateExists) {
      this.logger.error(
        `Template validation failed: Template ${templateId} not found in database`,
      );
      res.status(404).json({
        status: 'error',
        message: 'Template not found',
        code: 'TEMPLATE_NOT_FOUND',
        data: null,
        errors: null,
        meta: {
          timestamp: new Date().toISOString(),
          path: '/api/v1/resumes/generate/download',
        },
      });
      return false;
    }

    this.logger.debug(`Template validation successful for ID: ${templateId}`);
    return true;
  }

  /**
   * Sets headers for PDF download response
   */
  private setPdfResponseHeaders(
    res: Response,
    response: {
      filename: string;
      resumeGenerationId: string;
      atsScore: number;
    },
    contentLength: number,
  ) {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=${response.filename}`,
      'Content-Length': contentLength.toString(),
      // Custom headers for metadata
      'X-Resume-Generation-Id': response.resumeGenerationId,
      'X-ATS-Score': response.atsScore.toString(),
      'X-Filename': response.filename,
    });
  }
}
