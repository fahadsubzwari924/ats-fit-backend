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
import { Resume } from '../../database/entities';
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
  async uploadResume(
    @UploadedFile(FileValidationPipe) resumeFile: Express.Multer.File,
    @Req() request: RequestWithUserContext,
  ): Promise<Partial<Resume>> {
    const userId = request?.userContext?.userId;

    await this.validateUploadResumeRequest(resumeFile, userId);

    const resume = await this.resumeService.uploadUserResume(
      userId,
      resumeFile,
    );

    return {
      id: resume.id,
      fileName: resume.fileName,
      s3Url: resume.s3Url,
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
    resumeFile: Express.Multer.File,
    userId: string,
  ): Promise<void> {
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
