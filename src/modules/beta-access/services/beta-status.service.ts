import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BetaInvite, BetaInviteStatus } from '../../../database/entities/beta-invite.entity';
import { User } from '../../../database/entities/user.entity';
import { BetaStatusResponseDto } from '../dtos/beta-status-response.dto';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class BetaStatusService {
  private readonly logger = new Logger(BetaStatusService.name);

  constructor(
    @InjectRepository(BetaInvite)
    private readonly betaInviteRepo: Repository<BetaInvite>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getStatus(userId: string): Promise<BetaStatusResponseDto> {
    // 1. Load user by id
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2a. Load the invite redeemed by this user (if any)
    const redeemedInvite = await this.betaInviteRepo.findOne({
      where: { redeemed_by_user_id: userId },
    });

    // 2b. Check for a pending invite matched by email (not yet redeemed)
    const pendingInvite = await this.betaInviteRepo.findOne({
      where: {
        email: normalizeEmail(user.email),
        status: BetaInviteStatus.PENDING,
      },
    });

    // 3. Derive computed fields
    const now = new Date();

    const betaAccessUntil = user.beta_access_until ?? null;
    const hasActiveBetaAccess =
      betaAccessUntil !== null && betaAccessUntil > now;

    const daysRemaining = hasActiveBetaAccess
      ? Math.ceil((betaAccessUntil!.getTime() - now.getTime()) / 86_400_000)
      : null;

    // has_pending_redemption: invite exists (pending) and user hasn't activated beta access yet
    const hasPendingRedemption =
      !!pendingInvite && !user.beta_access_until && !redeemedInvite;

    // post_expiry_offer: show only when user was beta, access has expired, and rate is locked
    const isExpiredBetaUser =
      user.is_beta_user && !hasActiveBetaAccess && user.founding_rate_locked;

    const postExpiryOffer = isExpiredBetaUser
      ? { eligible: true as const, monthly_price_usd: 7.20, price_monthly: 7.20, discount_pct: 40 }
      : null;

    // Derive status from computed flags
    let status: BetaStatusResponseDto['status'];
    if (hasActiveBetaAccess) {
      status = 'active';
    } else if (hasPendingRedemption) {
      status = 'pending';
    } else if (user.is_beta_user && betaAccessUntil !== null && betaAccessUntil <= now) {
      status = 'expired';
    } else {
      status = 'not_invited';
    }

    const dto = new BetaStatusResponseDto();
    dto.status = status;
    dto.is_beta_user = user.is_beta_user;
    dto.has_pending_redemption = hasPendingRedemption;
    dto.beta_access_until = betaAccessUntil;
    dto.days_remaining = daysRemaining;
    dto.founding_rate_locked = user.founding_rate_locked;
    dto.post_expiry_offer = postExpiryOffer;

    return dto;
  }
}
