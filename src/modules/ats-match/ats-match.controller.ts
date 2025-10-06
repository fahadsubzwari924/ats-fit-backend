import {
  Controller,
  Post,
  UploadedFile,
  Body,
  UseInterceptors,
  Req,
  Get,
  Query,
  Param,
} from '@nestjs/common';
import { RateLimitFeature } from '../rate-limit/rate-limit.guard';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileValidationPipe } from '../../shared/pipes/file-validation.pipe';
import { AtsScoreResponseDto } from './dto/ats-score-response.dto';
import { AtsMatchService } from './ats-match.service';
import { AtsScoreRequestDto } from './dto/ats-score-request.dto';

import { Public } from '../auth/decorators/public.decorator';
import { UsageTrackingInterceptor } from '../rate-limit/usage-tracking.interceptor';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { AtsMatchHistoryService } from './ats-match-history.service';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { AtsMatchHistory } from '../../database/entities';
import { AtsMatchHistoryQueryDto } from './dto/ats-match-history-query.dto';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { UserPlan, UserType } from '../../database/entities/user.entity';
import { HelperUtil } from '../../shared/utils/helper.util';
import { IResumeContentProvider } from '../../shared/interfaces/resume-content-provider.interface';
import { RESUME_CONTENT_PROVIDER } from '../../shared/tokens/resume-content-provider.token';
import { Inject } from '@nestjs/common';
import {
  BadRequestException,
  NotFoundException,
} from '../../shared/exceptions/custom-http-exceptions';

@Controller('ats-match')
export class AtsMatchController {
  constructor(
    private readonly atsMatchService: AtsMatchService,
    private readonly atsMatchHistoryService: AtsMatchHistoryService,
    private readonly rateLimitService: RateLimitService,
    @Inject(RESUME_CONTENT_PROVIDER)
    private readonly resumeContentService: IResumeContentProvider,
  ) {}

  @Post('score')
  @Public()
  @RateLimitFeature(FeatureType.ATS_SCORE)
  @UseInterceptors(FileInterceptor('resumeFile'), UsageTrackingInterceptor)
  async calculateAtsScore(
    @Body() dto: AtsScoreRequestDto,
    @UploadedFile(FileValidationPipe)
    resumeFile?: Express.Multer.File,
    @Req() request?: RequestWithUserContext,
  ): Promise<AtsScoreResponseDto> {
    const userContext = request?.userContext;

    const atsScoreResponse = await this.atsMatchService.calculateAtsScore(
      dto.jobDescription,
      resumeFile,
      {
        userId: userContext?.userId,
        guestId: userContext?.guestId,
        userType: userContext?.userType || 'guest',
      },
      {
        companyName: dto.companyName,
        resumeContent: dto.resumeContent,
      },
    );

    return atsScoreResponse;
  }

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

  @Get('history/:userId')
  async getAtsMatchHistory(
    @Param('userId') userId: string,
    @Query() query: AtsMatchHistoryQueryDto,
    @Req() request: RequestWithUserContext,
  ): Promise<Partial<AtsMatchHistory>[]> {
    const { fields } = query;

    if (!userId) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.RESUME_ID_REQUIRED_VALIDATION_ERROR,
      );
    }

    const userContext = request?.userContext;
    if (!userContext) {
      throw new BadRequestException(
        'User context is missing',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const userPlan = HelperUtil.validateEnumValue(
      UserPlan,
      userContext.plan,
      UserPlan.FREEMIUM,
    );

    const userType = HelperUtil.validateEnumValue(
      UserType,
      userContext.userType,
      UserType.REGISTERED,
    );

    const rateLimitConfig = await this.rateLimitService.getRateLimitConfig(
      userPlan,
      userType,
      FeatureType.ATS_SCORE_HISTORY,
    );

    const allowedDays = rateLimitConfig?.monthly_limit || 0;

    const atsMatchHistory =
      await this.atsMatchHistoryService.getAtsMatchHistoryByUserId(
        userId,
        fields,
        allowedDays,
      );

    if (!atsMatchHistory.length) {
      throw new NotFoundException(
        'No ATS match history found for the user',
        ERROR_CODES.ATS_MATCH_HISTORY_NOT_FOUND,
      );
    }

    return atsMatchHistory;
  }
}
