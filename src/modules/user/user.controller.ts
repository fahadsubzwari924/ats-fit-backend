import {
  Body,
  ConflictException,
  Controller,
  Post,
  Patch,
  Get,
  Headers,
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
import { FileValidationPipe } from '../../shared/pipes/file-validation.pipe';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { MimeTypes } from '../../shared/constants/mime-types.enum';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { QueueMessageStatus } from '../../shared/enums/queue-message.enum';
import { ResumeService } from '../resume-tailoring/services/resume.service';
import { UserService } from './user.service';
import { ResumeQueueService } from '../resume-tailoring/services/resume-queue.service';
import { ResumeContentService } from '../resume-tailoring/services/resume-content.service';
import { ResumeProfileEnrichmentService } from '../resume-tailoring/services/resume-profile-enrichment.service';
import {
  ProcessingStatusEnum,
  ResumeProfileStatusResponse,
} from '../resume-tailoring/interfaces/resume-profile-enrichment.interface';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { UserMeResponseDto } from './dtos/user-me-response.dto';
import { IFeatureUsage } from '../../shared/interfaces';
import {
  BadRequestException,
  NotFoundException,
} from '../../shared/exceptions/custom-http-exceptions';
import { ReplaceResumeService } from './services/replace-resume.service';
import { RestoreArchivedResumeService } from './services/restore-archived-resume.service';
import { ReplacementQuotaService } from './services/replacement-quota.service';
import { RestoreArchivedResumeDto } from './dtos/restore-archived-resume.dto';
import { ReplaceResumeResponseDto } from './dtos/replace-resume-response.dto';
import { IReplacementQuota } from './interfaces/replacement-quota.interface';
import { ResumeReplacementErrorCode } from '../../shared/enums/resume-replacement.enum';
import { RESUME_REPLACEMENT } from '../../shared/constants/resume-replacement.constants';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly resumeService: ResumeService,
    private readonly userService: UserService,
    private readonly resumeQueueService: ResumeQueueService,
    private readonly resumeContentService: ResumeContentService,
    private readonly resumeProfileEnrichmentService: ResumeProfileEnrichmentService,
    private readonly replaceResumeService: ReplaceResumeService,
    private readonly restoreArchivedResumeService: RestoreArchivedResumeService,
    private readonly replacementQuotaService: ReplacementQuotaService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  async getMe(@Req() request: RequestWithUserContext) {
    const userId = request?.userContext?.userId;

    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    return this.userService.getCurrentUser(userId);
  }

  @Get('resume-profile-status')
  @ApiOperation({
    summary: 'Get resume profile enrichment status',
    description:
      "Returns current state of the user's enriched profile for polling after upload (tailoring mode, questions count, completeness)",
  })
  @ApiResponse({
    status: 200,
    description: 'Resume profile status',
    schema: {
      type: 'object',
      properties: {
        hasResume: { type: 'boolean' },
        processingStatus: {
          type: 'string',
          enum: ['none', 'queued', 'processing', 'completed', 'failed'],
        },
        questionsTotal: { type: 'number' },
        questionsAnswered: { type: 'number' },
        profileCompleteness: { type: 'number' },
        enrichedProfileId: { type: 'string', nullable: true },
        tailoringMode: {
          type: 'string',
          enum: ['none', 'standard', 'enhanced', 'precision'],
        },
      },
    },
  })
  async getResumeProfileStatus(@Req() request: RequestWithUserContext): Promise<
    ResumeProfileStatusResponse & {
      replacementInProgress: boolean;
      lastArchivedExtractId: string | null;
      quota: IReplacementQuota | null;
    }
  > {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }
    const status =
      await this.resumeProfileEnrichmentService.getResumeProfileStatus(userId);
    const [lastArchived, quota]: [
      ExtractedResumeContent | null,
      IReplacementQuota | null,
    ] = await Promise.all([
      this.resumeContentService.getLastArchivedExtract(userId),
      this.replacementQuotaService
        .getCurrentQuota(userId)
        .catch((): null => null),
    ]);
    const replacementInProgress =
      (status.processingStatus === ProcessingStatusEnum.QUEUED ||
        status.processingStatus === ProcessingStatusEnum.PROCESSING) &&
      !!lastArchived;
    return {
      ...status,
      replacementInProgress,
      lastArchivedExtractId: lastArchived?.id ?? null,
      quota,
    };
  }

  @Get('feature-usage')
  @ApiOperation({
    summary: 'Get current user feature usage statistics',
    description:
      'Retrieves feature usage information for the authenticated user.',
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
            enum: ['resume_generation'],
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

  @Patch('onboarding/complete')
  @ApiOperation({
    summary: 'Mark onboarding as completed for the current user',
    description:
      'Sets onboarding_completed = true on the user record. Called once at the end of the onboarding flow (either after upload or on skip).',
  })
  @ApiResponse({
    status: 200,
    description: 'Onboarding marked as completed. Returns updated user.',
  })
  async completeOnboarding(
    @Req() request: RequestWithUserContext,
  ): Promise<UserMeResponseDto> {
    const userId = request?.userContext?.userId;

    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    this.logger.log(`Marking onboarding complete for user: ${userId}`);
    return this.userService.markOnboardingComplete(userId);
  }

  @Post('upload-resume')
  @UseInterceptors(FileInterceptor('resumeFile'))
  @ApiOperation({
    summary: 'Upload resume (available to all authenticated users)',
    description: `
      Upload a resume file. The file is uploaded to S3 immediately.
      For all registered (non-guest) users, background processing is also triggered
      automatically to extract content and generate onboarding profile questions.
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
          description: 'Async processing info (for all registered users)',
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

    // Trigger async processing for authenticated users.
    // Profile question generation is a core onboarding step required on every plan;
    // gating it on isPremium would silently break onboarding for freemium users.
    if (userId) {
      this.logger.log(
        `Starting async resume processing for user ${userId}, file: ${resume.fileName}`,
      );

      try {
        const extractedContent =
          await this.resumeQueueService.addResumeProcessingJob(
            userId,
            resume.fileName,
            resume.s3Url,
          );

        return {
          ...result,
          asyncProcessing: {
            processingId: extractedContent.id,
            status:
              extractedContent.queueMessage?.status ||
              QueueMessageStatus.QUEUED,
            message: 'Resume processing initiated',
          },
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Async processing failed for resume ${resume.fileName}: ${errorMessage}`,
        );
        // S3 upload succeeded; return that even if queue enqueue fails
        return result;
      }
    }

    return result;
  }

  @Post('replace-resume')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Replace active resume (premium only)',
    description:
      'Atomically archives current resume and enqueues new file for extraction. Max 3 replacements per billing period.',
  })
  @ApiResponse({ status: 201, description: 'Replacement queued' })
  async replaceResume(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: RequestWithUserContext,
    @Headers(RESUME_REPLACEMENT.IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ): Promise<ReplaceResumeResponseDto> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }
    return this.replaceResumeService.execute({ userId, file, idempotencyKey });
  }

  @Post('restore-archived-resume')
  @ApiOperation({
    summary: 'Restore a previously archived resume',
    description:
      'Atomically swaps the archived extract back to active. Only allowed within 7-day restore window.',
  })
  @ApiResponse({ status: 201, description: 'Resume restored' })
  async restoreArchivedResume(
    @Body() dto: RestoreArchivedResumeDto,
    @Req() request: RequestWithUserContext,
  ): Promise<{ restoredAt: Date }> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'User authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }
    return this.restoreArchivedResumeService.execute(
      userId,
      dto.archivedExtractId,
    );
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
    return await this.resumeContentService.getUserExtractedResumes(userId);
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
      await this.resumeContentService.getUserExtractedResumeById(
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

    const deleted = await this.resumeContentService.deleteExtractedResume(
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

    if (resume.isActive) {
      throw new ConflictException({
        code: ResumeReplacementErrorCode.CANNOT_DELETE_ACTIVE_RESUME,
        message: 'Cannot delete the active resume. Use replace-resume instead.',
      });
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
