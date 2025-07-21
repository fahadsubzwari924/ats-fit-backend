import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  BadRequestException,
  Logger,
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
  ): Promise<{ message: string; resumeId: string }> {
    // Validate file type at controller level
    if (resumeFile.mimetype !== String(MimeTypes.PDF)) {
      throw new BadRequestException(
        'Only PDF files are allowed',
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    const resume = await this.resumeService.uploadUserResume(
      userId,
      resumeFile,
    );

    return {
      message: 'Resume uploaded successfully',
      resumeId: resume.id,
    };
  }
}
