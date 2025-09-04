import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Logger,
  Delete,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
import { FileValidationPipe } from '../resume/pipes/file-validation.pipe';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { MimeTypes } from '../../shared/constants/mime-types.enum';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { ResumeService } from '../resume/services/resume.service';
import { Resume } from '../../database/entities';
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

  constructor(private readonly resumeService: ResumeService) {}

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
