import {
  Controller,
  Post,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Logger,
  Delete,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
import { FileValidationPipe } from '../resume/pipes/file-validation.pipe';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { MimeTypes } from '../../shared/constants/mime-types.enum';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { ResumeService } from '../resume/services/resume.service';
import { UserService } from './user.service';
import { QueueService } from '../queue/queue.service';
import { ExtractedResumeService } from '../resume/services/extracted-resume.service';

import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { IFeatureUsage } from '../../shared/interfaces';
import {
  BadRequestException,
  NotFoundException,
} from '../../shared/exceptions/custom-http-exceptions';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly resumeService: ResumeService,
    private readonly userService: UserService,
    private readonly queueService: QueueService,
    private readonly extractedResumeService: ExtractedResumeService,
  ) {}

  @Get('feature-usage')
  @ApiOperation({
    summary: 'Get current user feature usage statistics',
    description:
      'Retrieves comprehensive feature usage information for the authenticated user including ATS score and resume generation limits',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature usage statistics retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            enum: ['ats_score', 'resume_generation'],
            description: 'The feature name',
          },
          allowed: {
            type: 'number',
            description: 'Maximum allowed usage per month',
          },
          remaining: {
            type: 'number',
            description: 'Remaining usage for current month',
          },
          used: {
            type: 'number',
            description: 'Current usage count for this month',
          },
          usagePercentage: {
            type: 'string',
            description: 'Usage percentage in readable format (e.g., "20%")',
          },
          resetDate: {
            type: 'string',
            format: 'date-time',
            description: 'Date when usage counters reset',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getCurrentUserFeatureUsage(
    @Req() request: RequestWithUserContext,
  ): Promise<Array<IFeatureUsage>> {
    const userId = request?.userContext?.userId;

    if (!userId) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    this.logger.log(`Fetching feature usage for user: ${userId}`);

    return this.userService.getUserFeatureUsage(userId);
  }

  @Post('upload-resume')
  @UseGuards(PremiumUserGuard)
  @UseInterceptors(FileInterceptor('resumeFile'))
  @ApiOperation({
    summary: 'Upload resume with automatic premium processing',
    description: `
      Upload a resume file. The file will be uploaded to S3 immediately.
      For premium users, the resume will automatically be processed in the 
      background for faster future resume generation.
    `,
  })
  @ApiResponse({
    status: 201,
    description: 'Resume uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Resume ID' },
        fileName: { type: 'string', description: 'File name' },
        s3Url: { type: 'string', description: 'S3 URL' },
        asyncProcessing: {
          type: 'object',
          description: 'Async processing info (for premium users)',
          properties: {
            processingId: { type: 'string' },
            status: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  })
  async uploadResume(
    @UploadedFile(FileValidationPipe)
    resumeFile: Express.Multer.File | undefined,
    @Req() request: RequestWithUserContext,
  ): Promise<{
    id: string;
    fileName: string;
    s3Url: string;
    asyncProcessing?: {
      processingId: string;
      status: string;
      message: string;
    };
  }> {
    const userId = request?.userContext?.userId;

    await this.validateUploadResumeRequest(resumeFile, userId);

    // Original S3 upload functionality (always happens)
    const resume = await this.resumeService.uploadUserResume(
      userId,
      resumeFile,
    );

    const result = {
      id: resume.id,
      fileName: resume.fileName,
      s3Url: resume.s3Url,
    };

    // Automatic async processing for premium users
    const isPremiumUser = request?.userContext?.isPremium;

    if (isPremiumUser) {
      this.logger.log(
        `Starting async processing for resume ${resume.fileName} (premium user: ${userId})`,
      );

      try {
        const extractedContent = await this.queueService.addResumeProcessingJob(
          userId,
          resume.fileName,
          resumeFile.buffer,
        );

        return {
          ...result,
          asyncProcessing: {
            processingId: extractedContent.id,
            status: extractedContent.queueMessage?.status || 'queued',
            message:
              'Premium feature: Async processing initiated for faster future generations',
          },
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Async processing failed for resume ${resume.fileName}: ${errorMessage}`,
        );
        // Continue with regular upload even if async processing fails
        return result;
      }
    }

    return result;
  }

  @Get('processed-resumes')
  @ApiOperation({
    summary: 'Get all async processed resumes for the current user',
    description:
      'Retrieve a list of all resumes that have been processed asynchronously for faster generation',
  })
  @ApiResponse({
    status: 200,
    description: 'List of processed resumes',
    type: [ExtractedResumeContent],
  })
  async getProcessedResumes(
    @Req() request: RequestWithUserContext,
  ): Promise<ExtractedResumeContent[]> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    this.logger.log(`Fetching processed resumes for user ${userId}`);
    return await this.extractedResumeService.getUserExtractedResumes(userId);
  }

  @Get('processed-resumes/:processingId/status')
  @ApiOperation({
    summary: 'Get processing status of a specific resume',
    description: 'Check the async processing status of an uploaded resume',
  })
  @ApiParam({
    name: 'processingId',
    description: 'ID of the processing job to check status for',
  })
  @ApiResponse({
    status: 200,
    description: 'Processing status',
    type: ExtractedResumeContent,
  })
  async getProcessingStatus(
    @Param('processingId') processingId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<ExtractedResumeContent> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    const processedResume =
      await this.extractedResumeService.getUserExtractedResumeById(
        processingId,
        userId,
      );

    if (!processedResume) {
      throw new NotFoundException(
        'Processed resume not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    return processedResume;
  }

  @Delete('processed-resumes/:processingId')
  @ApiOperation({
    summary: 'Delete a processed resume',
    description: 'Remove a processed resume and its extracted content',
  })
  @ApiParam({
    name: 'processingId',
    description: 'ID of the processed resume to delete',
  })
  @ApiResponse({
    status: 200,
    description: 'Processed resume deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        deleted: { type: 'boolean' },
      },
    },
  })
  async deleteProcessedResume(
    @Param('processingId') processingId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<{ message: string; deleted: boolean }> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    const deleted = await this.extractedResumeService.deleteExtractedResume(
      processingId,
      userId,
    );

    if (!deleted) {
      throw new NotFoundException(
        'Processed resume not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    this.logger.log(
      `Processed resume ${processingId} deleted successfully for user ${userId}`,
    );

    return {
      message: 'Processed resume deleted successfully',
      deleted: true,
    };
  }

  @Delete('delete-resume/:resumeId')
  async deleteResume(
    @Param('resumeId') resumeId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<{ message: string }> {
    const userId = request?.userContext?.userId;

    this.validatedeleteResumeRequest(userId, resumeId);

    const resume = await this.resumeService.getResumeById(resumeId);
    if (!resume || resume.user.id !== userId) {
      throw new NotFoundException(
        'Resume not found or does not belong to the user',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    await this.resumeService.deleteResume(resumeId);

    return { message: 'Resume deleted successfully' };
  }

  private async validateUploadResumeRequest(
    resumeFile: Express.Multer.File | undefined,
    userId: string,
  ): Promise<void> {
    // Validate file is provided
    if (!resumeFile) {
      throw new BadRequestException(
        'Resume file is required for upload',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate file type
    if (resumeFile.mimetype !== String(MimeTypes.PDF)) {
      throw new BadRequestException(
        'Only PDF files are allowed',
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    // Validate user ID
    if (!userId) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    // Check if user already uploaded a resume
    const existingResumes = await this.resumeService.getUserResumes(userId);
    if (existingResumes?.length) {
      throw new BadRequestException(
        'Only one PDF resume is allowed to be uploaded',
        ERROR_CODES.SINGLE_RESUME_UPLOAD_ALLOWED,
      );
    }
  }

  private validatedeleteResumeRequest(userId: string, resumeId: string): void {
    if (!resumeId) {
      throw new BadRequestException(
        'Resume ID is required',
        ERROR_CODES.RESUME_ID_REQUIRED_VALIDATION_ERROR,
      );
    }

    if (!userId) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }
  }
}
