import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { Queue, Job } from 'bull';
import {
  BetaInvite,
  BetaInviteStatus,
} from '../../../database/entities/beta-invite.entity';
import { User, UserPlan } from '../../../database/entities/user.entity';
import { BrevoService } from '../../../shared/modules/external/services/brevo.service';

interface BetaExpiringSoonEmailJobData {
  userId: string;
  email: string;
  name?: string;
  daysRemaining: number;
  betaAccessUntil: Date;
}

interface BetaEndedOfferEmailJobData {
  userId: string;
  email: string;
  name?: string;
}

interface BetaPostExpiryFollowupEmailJobData {
  userId: string;
  email: string;
  name?: string;
}

@Processor('beta-access')
export class BetaExpirySweepProcessor {
  private readonly logger = new Logger(BetaExpirySweepProcessor.name);

  constructor(
    @InjectQueue('beta-access') private readonly betaQueue: Queue,
    @InjectRepository(BetaInvite)
    private readonly betaInviteRepo: Repository<BetaInvite>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly brevoService: BrevoService,
    private readonly configService: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Cron job: beta_expiry_sweep
  // Runs at 02:00 UTC daily.
  // Sweep A: enqueue T-3 reminder emails for invites expiring in 2–4 days.
  // Sweep B: downgrade users whose beta has already expired.
  // -------------------------------------------------------------------------
  @Process('beta_expiry_sweep')
  async handleBetaExpirySweep(job: Job): Promise<void> {
    this.logger.log(`[BetaExpirySweep] Starting sweep, job id: ${job.id}`);

    const now = new Date();

    // --- Sweep A: T-3 expiry reminders ---
    const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const fourDaysFromNow = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

    const expiringInvites = await this.betaInviteRepo
      .createQueryBuilder('invite')
      .where('invite.status = :status', { status: BetaInviteStatus.REDEEMED })
      .andWhere('invite.pro_access_until BETWEEN :twoDays AND :fourDays', {
        twoDays: twoDaysFromNow,
        fourDays: fourDaysFromNow,
      })
      .andWhere('invite.redeemed_by_user_id IS NOT NULL')
      .getMany();

    this.logger.log(
      `[BetaExpirySweep] Sweep A: found ${expiringInvites.length} invites expiring soon`,
    );

    for (const invite of expiringInvites) {
      const user = await this.userRepo.findOne({
        where: { id: invite.redeemed_by_user_id },
      });
      if (!user || !user.is_beta_user) continue;

      const msUntilExpiry = invite.pro_access_until.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msUntilExpiry / (24 * 60 * 60 * 1000));

      // Bull deduplicates by jobId — safe to call on every sweep run
      await this.betaQueue.add(
        'beta_expiring_soon_email',
        {
          userId: user.id,
          email: user.email,
          name: user.full_name,
          daysRemaining,
          betaAccessUntil: invite.pro_access_until,
        } as BetaExpiringSoonEmailJobData,
        { jobId: `expiry-reminder-${invite.id}` },
      );

      this.logger.log(
        `[BetaExpirySweep] Enqueued expiry reminder for user ${user.id} (${daysRemaining}d remaining)`,
      );
    }

    // --- Sweep B: Downgrade expired beta users ---
    const expiredUsers = await this.userRepo
      .createQueryBuilder('user')
      .where('user.is_beta_user = true')
      .andWhere('user.beta_access_until IS NOT NULL')
      .andWhere('user.beta_access_until < :now', { now })
      .getMany();

    this.logger.log(
      `[BetaExpirySweep] Sweep B: found ${expiredUsers.length} expired beta users`,
    );

    if (expiredUsers.length > 0) {
      const expiredUserIds = expiredUsers.map((u) => u.id);

      // Bulk downgrade: single UPDATE instead of per-user saves
      await this.userRepo.update({ id: In(expiredUserIds) }, {
        beta_access_until: null,
        plan: UserPlan.FREEMIUM,
      } as Partial<User>);

      // Lock founding rate for users who qualify but don't already have it set
      const usersNeedingRateLock = expiredUsers
        .filter((u) => !u.founding_rate_locked)
        .map((u) => u.id);

      if (usersNeedingRateLock.length > 0) {
        await this.userRepo.update({ id: In(usersNeedingRateLock) }, {
          founding_rate_locked: true,
        } as Partial<User>);
      }

      // Enqueue post-expiry emails for each downgraded user
      for (const user of expiredUsers) {
        await this.betaQueue.add(
          'beta_ended_offer_email',
          {
            userId: user.id,
            email: user.email,
            name: user.full_name,
          } as BetaEndedOfferEmailJobData,
          { jobId: `beta-ended-${user.id}` },
        );
      }

      this.logger.log(
        `[BetaExpirySweep] Bulk downgraded ${expiredUsers.length} users`,
      );
    }

    this.logger.log(
      `[BetaExpirySweep] Sweep complete. A=${expiringInvites.length} reminders, B=${expiredUsers.length} downgrades`,
    );
  }

  // -------------------------------------------------------------------------
  // Cron job: beta_invite_cleanup
  // Runs at 04:00 UTC daily.
  // Marks pending invites as 'expired' when their code_expires_at has passed.
  // -------------------------------------------------------------------------
  @Process('beta_invite_cleanup')
  async handleBetaInviteCleanup(job: Job): Promise<void> {
    this.logger.log(`[BetaInviteCleanup] Starting cleanup, job id: ${job.id}`);

    const now = new Date();

    const result = await this.betaInviteRepo
      .createQueryBuilder()
      .update(BetaInvite)
      .set({ status: BetaInviteStatus.EXPIRED })
      .where('status = :status', { status: BetaInviteStatus.PENDING })
      .andWhere('code_expires_at < :now', { now })
      .execute();

    this.logger.log(
      `[BetaInviteCleanup] Marked ${result.affected ?? 0} pending invites as expired`,
    );
  }

  // -------------------------------------------------------------------------
  // Email handler: beta_expiring_soon_email
  // Enqueued by Sweep A above with a stable jobId for idempotency.
  // -------------------------------------------------------------------------
  @Process('beta_expiring_soon_email')
  async handleBetaExpiringSoonEmail(
    job: Job<BetaExpiringSoonEmailJobData>,
  ): Promise<void> {
    const { userId, email, name, daysRemaining, betaAccessUntil } = job.data;

    this.logger.log(
      `[BetaExpiringSoonEmail] Processing job ${job.id} for user ${userId}`,
    );

    const templateId = this.configService.get<number>(
      'BREVO_TEMPLATE_ID_BETA_EXPIRING_SOON',
    );
    if (!templateId) {
      this.logger.warn(
        `BREVO_TEMPLATE_ID_BETA_EXPIRING_SOON not configured — skipping for user ${userId}`,
      );
      return;
    }

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'https://tairly.com';

    try {
      await this.brevoService.sendTransactionalEmail({
        to: [{ email, name: name ?? email }],
        templateId,
        params: {
          name: name ?? email,
          days_remaining: daysRemaining,
          beta_access_until: new Date(betaAccessUntil).toDateString(),
          checkout_url: `${frontendUrl}/billing`,
        },
      });

      this.logger.log(
        `[BetaExpiringSoonEmail] Sent to ${email} (user: ${userId})`,
      );
    } catch (error) {
      this.logger.error(`[BetaExpiringSoonEmail] Failed for user ${userId}`, {
        error: (error as Error).message,
        jobId: job.id,
      });
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Email handler: beta_ended_offer_email
  // Enqueued by Sweep B above with a stable jobId for idempotency.
  // -------------------------------------------------------------------------
  @Process('beta_ended_offer_email')
  async handleBetaEndedOfferEmail(
    job: Job<BetaEndedOfferEmailJobData>,
  ): Promise<void> {
    const { userId, email, name } = job.data;

    this.logger.log(
      `[BetaEndedOfferEmail] Processing job ${job.id} for user ${userId}`,
    );

    const templateId = this.configService.get<number>(
      'BREVO_TEMPLATE_ID_BETA_ENDED_OFFER',
    );
    if (!templateId) {
      this.logger.warn(
        `BREVO_TEMPLATE_ID_BETA_ENDED_OFFER not configured — skipping for user ${userId}`,
      );
      return;
    }

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'https://tairly.com';

    try {
      await this.brevoService.sendTransactionalEmail({
        to: [{ email, name: name ?? email }],
        templateId,
        params: {
          name: name ?? email,
          checkout_url: `${frontendUrl}/billing`,
        },
      });

      this.logger.log(
        `[BetaEndedOfferEmail] Sent to ${email} (user: ${userId})`,
      );
    } catch (error) {
      this.logger.error(`[BetaEndedOfferEmail] Failed for user ${userId}`, {
        error: (error as Error).message,
        jobId: job.id,
      });
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Email handler: beta_post_expiry_followup_email
  // Enqueued by the post-expiry cron processor (Job 2).
  // -------------------------------------------------------------------------
  @Process('beta_post_expiry_followup_email')
  async handleBetaPostExpiryFollowupEmail(
    job: Job<BetaPostExpiryFollowupEmailJobData>,
  ): Promise<void> {
    const { userId, email, name } = job.data;

    this.logger.log(
      `[BetaPostExpiryFollowupEmail] Processing job ${job.id} for user ${userId}`,
    );

    const templateId = this.configService.get<number>(
      'BREVO_TEMPLATE_ID_BETA_POST_EXPIRY_FOLLOWUP',
    );
    if (!templateId) {
      this.logger.warn(
        `BREVO_TEMPLATE_ID_BETA_POST_EXPIRY_FOLLOWUP not configured — skipping for user ${userId}`,
      );
      return;
    }

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'https://tairly.com';

    try {
      await this.brevoService.sendTransactionalEmail({
        to: [{ email, name: name ?? email }],
        templateId,
        params: {
          name: name ?? email,
          checkout_url: `${frontendUrl}/billing`,
        },
      });

      this.logger.log(
        `[BetaPostExpiryFollowupEmail] Sent to ${email} (user: ${userId})`,
      );
    } catch (error) {
      this.logger.error(
        `[BetaPostExpiryFollowupEmail] Failed for user ${userId}`,
        {
          error: (error as Error).message,
          jobId: job.id,
        },
      );
      throw error;
    }
  }
}
