import {
  Controller,
  Post,
  UploadedFile,
  Body,
  UseInterceptors,
  Req,
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

@ApiTags('ATS Match')
@Controller('ats-match')
export class AtsMatchController {
  constructor(private readonly atsMatchService: AtsMatchService) {}

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
}
