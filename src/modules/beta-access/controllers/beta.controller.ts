import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RedeemThrottleGuard } from '../guards/redeem-throttle.guard';
import { BetaRedemptionService } from '../services/beta-redemption.service';
import { BetaStatusService } from '../services/beta-status.service';
import { RedeemBetaCodeDto } from '../dtos/redeem-beta-code.dto';
import { BetaStatusResponseDto } from '../dtos/beta-status-response.dto';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { BetaRedemptionResult } from '../services/beta-redemption.service';

@Controller('beta')
@UseGuards(JwtAuthGuard)
export class BetaController {
  constructor(
    private readonly betaRedemptionService: BetaRedemptionService,
    private readonly betaStatusService: BetaStatusService,
  ) {}

  @Post('redeem')
  @UseGuards(RedeemThrottleGuard)
  @HttpCode(HttpStatus.OK)
  async redeemCode(
    @Body() dto: RedeemBetaCodeDto,
    @Req() req: RequestWithUserContext,
  ): Promise<BetaRedemptionResult> {
    const userId = req.userContext?.userId;
    return this.betaRedemptionService.redeem(userId, dto.code);
  }

  @Get('status')
  async getStatus(
    @Req() req: RequestWithUserContext,
  ): Promise<BetaStatusResponseDto> {
    const userId = req.userContext?.userId;
    return this.betaStatusService.getStatus(userId);
  }
}
