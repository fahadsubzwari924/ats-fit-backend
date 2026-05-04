import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue, Job } from 'bull';
import {
  BetaInvite,
  BetaInviteStatus,
} from '../../../database/entities/beta-invite.entity';
import { User } from '../../../database/entities/user.entity';

@Processor('beta-access')
export class BetaPostExpiryEmailProcessor {
  private readonly logger = new Logger(BetaPostExpiryEmailProcessor.name);

  constructor(
    @InjectQueue('beta-access') private readonly betaQueue: Queue,
    @InjectRepository(BetaInvite)
    private readonly betaInviteRepo: Repository<BetaInvite>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  // -------------------------------------------------------------------------
  // Cron job: beta_post_expiry_email
  // Runs at 03:00 UTC daily.
  // Sends a T+7 follow-up to founding-rate-locked users whose beta ended
  // roughly 7 days ago (pro_access_until between 8d ago and 6d ago).
  // Bull jobId dedup prevents duplicate emails per invite.
  // -------------------------------------------------------------------------
  @Process('beta_post_expiry_email')
  async handleBetaPostExpiryEmail(job: Job): Promise<void> {
    this.logger.log(`[BetaPostExpiryEmail] Starting sweep, job id: ${job.id}`);

    const now = new Date();
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    // Find redeemed invites that expired ~7 days ago
    const invites = await this.betaInviteRepo
      .createQueryBuilder('invite')
      .where('invite.status = :status', { status: BetaInviteStatus.REDEEMED })
      .andWhere(
        'invite.pro_access_until BETWEEN :eightDaysAgo AND :sixDaysAgo',
        {
          eightDaysAgo,
          sixDaysAgo,
        },
      )
      .andWhere('invite.redeemed_by_user_id IS NOT NULL')
      .getMany();

    this.logger.log(
      `[BetaPostExpiryEmail] Found ${invites.length} candidates for T+7 follow-up`,
    );

    for (const invite of invites) {
      const user = await this.userRepo.findOne({
        where: {
          id: invite.redeemed_by_user_id,
          is_beta_user: true,
          founding_rate_locked: true,
        },
      });

      // Only send to founding-rate-locked users who have already been downgraded
      if (!user || user.beta_access_until !== null) continue;

      // Stable jobId ensures idempotency across daily runs
      await this.betaQueue.add(
        'beta_post_expiry_followup_email',
        { userId: user.id, email: user.email, name: user.full_name },
        { jobId: `post-expiry-${invite.id}` },
      );

      this.logger.log(
        `[BetaPostExpiryEmail] Enqueued post-expiry follow-up for user ${user.id}`,
      );
    }

    this.logger.log(
      `[BetaPostExpiryEmail] Sweep complete, processed ${invites.length} candidates`,
    );
  }
}
