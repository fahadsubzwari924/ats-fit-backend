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
import { FileValidationPipe } from './pipes/file-validation.pipe';
import { ValidationLoggingInterceptor } from './interceptors/validation-logging.interceptor';
import { NotFoundException } from '../../shared/exceptions/custom-http-exceptions';
import { RateLimitFeature } from '../rate-limit/rate-limit.guard';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { Public } from '../auth/decorators/public.decorator';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
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
    @UploadedFile(FileValidationPipe) resumeFile: Express.Multer.File,
    @Req() request: RequestWithUserContext,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const startTime = Date.now();

    try {
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
