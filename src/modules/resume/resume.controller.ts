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
import { UsageTrackingInterceptor } from '../rate-limit/usage-tracking.interceptor';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { ERROR_CODES } from '../../shared/constants/error-codes';
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
  @UseInterceptors(
    FileInterceptor('resumeFile'),
    ValidationLoggingInterceptor,
    UsageTrackingInterceptor,
  )
  async generateTailoredResume(
    @Body() generateResumeDto: GenerateTailoredResumeDto,
    @UploadedFile(FileValidationPipe) resumeFile: Express.Multer.File,
    @Req() request: RequestWithUserContext,
    @Res() res: Response,
  ) {
    try {
      const authContext = request.userContext;
      // Debug logging
      this.logger.log('Received generate resume request');
      this.logger.log('Body data:', JSON.stringify(generateResumeDto, null, 2));
      this.logger.log('File data:', {
        filename: resumeFile?.originalname,
        mimetype: resumeFile?.mimetype,
        size: resumeFile?.size,
        hasBuffer: !!resumeFile?.buffer,
      });

      // Validate that the template exists before processing
      await this.validateResumeTemplateExists(generateResumeDto.templateId);

      const { orignalResumeText, tailoredResume, analysis } =
        await this.resumeService.generateTailoredResume(
          generateResumeDto?.jobDescription,
          generateResumeDto?.companyName,
          resumeFile,
          generateResumeDto?.templateId,
        );

      const generatedPDF =
        await this.resumeService['generatePdfService'].generatePdfFromHtml(
          tailoredResume,
        );

      const resumeGenerationPayload = {
        user_id: authContext?.userId,
        guest_id: authContext?.guestId,
        file_path: resumeFile?.originalname,
        original_content: orignalResumeText,
        tailored_content: analysis,
        template_id: generateResumeDto?.templateId,
        job_description: generateResumeDto?.jobDescription,
        company_name: generateResumeDto?.companyName,
        analysis: analysis ?? null,
      };
      await this.resumeService.saveResumeGeneration(resumeGenerationPayload);

      // Send the PDF back as the response
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=tailored-resume-${Date.now()}.pdf`,
        'Content-Length': generatedPDF.length,
      });
      res.end(generatedPDF);
    } catch (error) {
      this.logger.error('Error in generateTailoredResume:', error);
      if (error instanceof Error) {
        this.logger.error('Error stack:', error.stack);
        this.logger.error('Error message:', error.message);
      }

      if (error instanceof NotFoundException) {
        throw error;
      }
      if ((error as Error)?.message?.includes('not found')) {
        throw new NotFoundException(
          'Template not found',
          ERROR_CODES.RESUME_TEMPLATE_NOT_FOUND,
        );
      }
      // Re-throw the error to let the global exception filter handle it
      throw error;
    }
  }

  private async validateResumeTemplateExists(
    templateId: string,
  ): Promise<void> {
    try {
      await this.resumeTemplateService.getTemplateById(templateId);
    } catch (error) {
      this.logger.error(
        `Template validation failed for ID: ${templateId}`,
        error,
      );
      throw new NotFoundException('Template not found');
    }
  }
}
