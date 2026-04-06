import { Controller, Req, Get } from '@nestjs/common';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { IResumeContentProvider } from '../../shared/interfaces/resume-content-provider.interface';
import { RESUME_CONTENT_PROVIDER } from '../../shared/tokens/resume-content-provider.token';
import { Inject } from '@nestjs/common';
import { BadRequestException } from '../../shared/exceptions/custom-http-exceptions';
import { UserType } from '../../database/entities/user.entity';

@Controller('ats-match')
export class AtsMatchController {
  constructor(
    @Inject(RESUME_CONTENT_PROVIDER)
    private readonly resumeContentService: IResumeContentProvider,
  ) {}

  /**
   * Get user's processed resume information
   * Note: Each user can only have one processed resume at a time
   * Returns basic info about the single processed resume or null if none exists
   */
  @Get('available-resumes')
  async getAvailableResumes(
    @Req() request: RequestWithUserContext,
  ): Promise<any> {
    const userContext = request?.userContext;

    if (!userContext?.userId) {
      throw new BadRequestException(
        'Authentication required to view available resumes',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    // Check if user can use pre-processed resume feature
    if (
      !this.resumeContentService.canUsePreProcessedResume(
        userContext.userType as UserType,
      )
    ) {
      throw new BadRequestException(
        'Pre-processed resume feature is not available for your user type',
        ERROR_CODES.FEATURE_NOT_AVAILABLE_FOR_GUEST_USERS,
      );
    }

    return await this.resumeContentService.getUserProcessedResumeInfo(
      userContext.userId,
    );
  }
}
