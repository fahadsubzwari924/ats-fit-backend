import {
  Controller,
  Post,
  UploadedFile,
  Body,
  UseInterceptors,
} from '@nestjs/common';
import { RateLimitFeature } from '../rate-limit/rate-limit.guard';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileValidationPipe } from '../resume/pipes/file-validation.pipe';
import { AtsScoreResponseDto } from './dto/ats-score-response.dto';
import {
  ApiOperation,
  ApiConsumes,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AtsMatchService } from './ats-match.service';
import { AtsScoreRequestDto } from './dto/ats-score-request.dto';
import { Public } from '../auth/decorators/public.decorator';
import { UsageTrackingInterceptor } from '../rate-limit/usage-tracking.interceptor';

@ApiTags('ATS Match')
@Controller('ats-match')
export class AtsMatchController {
  constructor(private readonly atsMatchService: AtsMatchService) {}

  @Post('score')
  @Public()
  @RateLimitFeature(FeatureType.ATS_SCORE)
  @UseInterceptors(FileInterceptor('resumeFile'), UsageTrackingInterceptor)
  @ApiOperation({ summary: 'Calculate ATS compliance score' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 200,
    description: 'ATS score calculated',
    type: AtsScoreResponseDto,
  })
  async calculateAtsScore(
    @Body() dto: AtsScoreRequestDto,
    @UploadedFile(FileValidationPipe) resumeFile: Express.Multer.File,
  ): Promise<AtsScoreResponseDto> {
    return this.atsMatchService.calculateAtsScore(
      dto.jobDescription,
      resumeFile,
    );
  }
}
