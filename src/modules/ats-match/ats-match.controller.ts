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
import { FileValidationPipe } from '../resume/pipes/file-validation.pipe';
import { AtsScoreResponseDto } from './dto/ats-score-response.dto';
import { ApiTags } from '@nestjs/swagger';
import { AtsMatchService } from './ats-match.service';
import { AtsScoreRequestDto } from './dto/ats-score-request.dto';
import { Public } from '../auth/decorators/public.decorator';
import { UsageTrackingInterceptor } from '../rate-limit/usage-tracking.interceptor';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { AtsMatchHistoryService } from './ats-match-history.service';
import {
  BadRequestException,
  NotFoundException,
} from 'src/shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from 'src/shared/constants/error-codes';
import { AtsMatchHistory } from 'src/database/entities';
import { AtsMatchHistoryQueryDto } from './dto/ats-match-history-query.dto';

@ApiTags('ATS Match')
@Controller('ats-match')
export class AtsMatchController {
  constructor(
    private readonly atsMatchService: AtsMatchService,
    private readonly atsMatchHistoryService: AtsMatchHistoryService,
  ) {}

  @Post('score')
  @Public()
  @RateLimitFeature(FeatureType.ATS_SCORE)
  @UseInterceptors(FileInterceptor('resumeFile'), UsageTrackingInterceptor)
  async calculateAtsScore(
    @Body() dto: AtsScoreRequestDto,
    @UploadedFile(FileValidationPipe) resumeFile: Express.Multer.File,
    @Req() request: RequestWithUserContext,
  ): Promise<AtsScoreResponseDto> {
    const atsScoreResponse = await this.atsMatchService.calculateAtsScore(
      dto.jobDescription,
      resumeFile,
    );

    const userContext = request?.userContext;

    const atsMatchHistory = {
      user_id: userContext?.userId || null,
      guest_id: userContext?.guestId || null,
      ats_score: atsScoreResponse.score,
      company_name: dto.companyName,
      job_description: dto.jobDescription,
      resume_content: dto.resumeContent || '',
      analysis: atsScoreResponse?.details,
    };
    await this.atsMatchService.saveAtsMatchHistory(atsMatchHistory);

    return atsScoreResponse;
  }

  @Get('history/:userId')
  async getAtsMatchHistory(
    @Param('userId') userId: string,
    @Query() query: AtsMatchHistoryQueryDto,
  ): Promise<Partial<AtsMatchHistory>[]> {
    const { fields } = query;

    if (!userId) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.RESUME_ID_REQUIRED_VALIDATION_ERROR,
      );
    }

    const atsMatchHistory =
      await this.atsMatchHistoryService.getAtsMatchHistoryByUserId(
        userId,
        fields,
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
