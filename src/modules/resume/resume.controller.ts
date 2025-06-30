import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiConsumes, 
  ApiBody, 
  ApiResponse,
  ApiBearerAuth 
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ResumeTemplateService } from './services/resume-templates.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResumeService } from './services/resume.service';
import { GenerateTailoredResumeDto } from './dtos/generate-tailored-resume.dto';
import { FileValidationPipe } from './pipes/file-validation.pipe';
import { ValidationLoggingInterceptor } from './interceptors/validation-logging.interceptor';
import { Response } from 'express';
import { NotFoundException } from '../../shared/exceptions/custom-http-exceptions';

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
  @ApiOperation({ summary: 'Get available resume templates' })
  @ApiResponse({ 
    status: 200, 
    description: 'List of available resume templates',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          thumbnail: { type: 'string' },
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTemplates() {
    const templates = await this.resumeTemplateService.getResumeTemplates();
    return templates;
  }


  @Post('generate')
  @UseInterceptors(FileInterceptor('resumeFile'), ValidationLoggingInterceptor)
  @ApiOperation({ 
    summary: 'Generate a tailored resume',
    description: 'Upload a resume file and generate a tailored version based on job description and company'
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ 
    status: 200, 
    description: 'Tailored resume generated successfully',
    content: {
      'application/pdf': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async generateTailoredResume(
    @Body() generateResumeDto: GenerateTailoredResumeDto,
    @UploadedFile(FileValidationPipe) resumeFile: Express.Multer.File,
    @Res() res: Response,
  ) {
    try {
      // Debug logging
      this.logger.log('Received generate resume request');
      this.logger.log('Body data:', JSON.stringify(generateResumeDto, null, 2));
      this.logger.log('File data:', {
        filename: resumeFile?.originalname,
        mimetype: resumeFile?.mimetype,
        size: resumeFile?.size,
        hasBuffer: !!resumeFile?.buffer
      });

      // Validate that the template exists before processing
      await this.validateResumeTemplateExists(generateResumeDto.templateId);

      return this.resumeService.generateTailoredResume(
          generateResumeDto.jobDescription,
          generateResumeDto.companyName,
        resumeFile,
          generateResumeDto.templateId,
        res,
      );
    } catch (error) {
      this.logger.error('Error in generateTailoredResume:', error);
      this.logger.error('Error stack:', error.stack);
      this.logger.error('Error message:', error.message);
      
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error.message?.includes('not found')) {
        throw new NotFoundException('Template not found');
      }
      // Re-throw the error to let the global exception filter handle it
      throw error;
    }
  }

  private async validateResumeTemplateExists(templateId: string): Promise<void> {
    try {
      await this.resumeTemplateService.getTemplateById(templateId);
    } catch (error) {
      this.logger.error(`Template validation failed for ID: ${templateId}`, error);
      throw new NotFoundException('Template not found');
    }
  }
}
