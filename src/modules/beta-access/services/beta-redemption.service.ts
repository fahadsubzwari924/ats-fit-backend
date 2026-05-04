import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  BetaInvite,
  BetaInviteStatus,
} from '../../../database/entities/beta-invite.entity';
import { User } from '../../../database/entities/user.entity';
import { BETA_ERRORS } from '../constants/beta-error-codes';
import { normalizeEmail } from '../utils/email-normalize.util';

export interface BetaRedemptionResult {
  ok: true;
  beta_access_until: Date;
  days_remaining: number;
  founding_rate_locked: boolean;
}

@Injectable()
export class BetaRedemptionService {
  private readonly logger = new Logger(BetaRedemptionService.name);

  constructor(
    @InjectRepository(BetaInvite)
    private readonly betaInviteRepo: Repository<BetaInvite>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    @InjectQueue('beta-access')
    private readonly betaQueue: Queue,
  ) {}

  async redeem(userId: string, code: string): Promise<BetaRedemptionResult> {
    const result = await this.dataSource.transaction(async (manager) => {
      // 1. Load invite with row-level lock to prevent concurrent redemptions
      const invite = await manager.findOne(BetaInvite, {
        where: { code: code.toUpperCase() },
        lock: { mode: 'pessimistic_write' },
      });

      // 2. Invite not found
      if (!invite) {
        throw new NotFoundException(BETA_ERRORS.CODE_NOT_FOUND);
      }

      // 3. Check invite status
      if (invite.status === BetaInviteStatus.REDEEMED) {
        throw new ConflictException(BETA_ERRORS.CODE_ALREADY_REDEEMED);
      }
      if (invite.status === BetaInviteStatus.REVOKED) {
        throw new ConflictException(BETA_ERRORS.CODE_REVOKED);
      }
      if (invite.status === BetaInviteStatus.EXPIRED) {
        throw new BadRequestException(BETA_ERRORS.CODE_EXPIRED);
      }

      // 4. Check code expiry even for pending status (handles pending but past-expiry)
      if (invite.code_expires_at < new Date()) {
        throw new BadRequestException(BETA_ERRORS.CODE_EXPIRED);
      }

      // 5. Load the authenticated user
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // 6. Strict email match (case-insensitive)
      if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) {
        throw new ForbiddenException(BETA_ERRORS.EMAIL_MISMATCH);
      }

      // 7. Compute pro access expiry
      const now = new Date();
      const proAccessUntil = new Date(
        now.getTime() + invite.access_days * 86_400_000,
      );

      // 8. Update invite: mark as redeemed
      invite.status = BetaInviteStatus.REDEEMED;
      invite.redeemed_at = now;
      invite.redeemed_by_user_id = userId;
      invite.pro_access_until = proAccessUntil;
      await manager.save(BetaInvite, invite);

      // 9. Update user: grant beta pro access and lock founding rate
      user.is_beta_user = true;
      user.beta_access_until = proAccessUntil;
      user.founding_rate_locked = true;
      await manager.save(User, user);

      this.logger.log(
        `Beta code redeemed: userId=${userId} inviteId=${invite.id} proAccessUntil=${proAccessUntil.toISOString()}`,
      );

      return {
        ok: true as const,
        beta_access_until: proAccessUntil,
        days_remaining: Math.ceil(
          (proAccessUntil.getTime() - Date.now()) / 86_400_000,
        ),
        founding_rate_locked: true,
        userEmail: user.email,
        userFullName: user.full_name,
      };
    });

    // 11. Enqueue beta_redeemed_email job after transaction commits (non-critical)
    try {
      await this.betaQueue.add('beta_redeemed_email', {
        userId,
        email: result.userEmail,
        name: result.userFullName,
        betaAccessUntil: result.beta_access_until,
      });
    } catch (queueErr) {
      this.logger.error(
        `[BetaRedemption] Failed to enqueue beta_redeemed_email for inviteId tied to userId=${userId}: ${(queueErr as Error).message}`,
      );
      // Non-critical — redemption succeeded; do not rethrow
    }

    // 12. Return final result (strip internal userEmail field)
    const { userEmail: _email, userFullName: _name, ...publicResult } = result;
    return publicResult as BetaRedemptionResult;
  }
}
