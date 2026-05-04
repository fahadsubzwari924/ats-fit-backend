import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { ExternalModule } from '../../shared/modules/external/external.module';
import { Queue } from 'bull';
import { BetaInvite } from '../../database/entities/beta-invite.entity';
import { User } from '../../database/entities/user.entity';
import { AdminBetaController } from './controllers/admin-beta.controller';
import { BetaController } from './controllers/beta.controller';
import { BetaInviteService } from './services/beta-invite.service';
import { BetaRedemptionService } from './services/beta-redemption.service';
import { BetaStatusService } from './services/beta-status.service';
import { BetaEntitlementService } from './services/beta-entitlement.service';
import { BetaInviteEmailProcessor } from './jobs/beta-invite-email.processor';
import { BetaRedeemedEmailProcessor } from './jobs/beta-redeemed-email.processor';
import { BetaExpirySweepProcessor } from './jobs/beta-expiry-sweep.processor';
import { BetaPostExpiryEmailProcessor } from './jobs/beta-post-expiry-email.processor';
import { AdminGuard } from './guards/admin.guard';
import { RedeemThrottleGuard } from './guards/redeem-throttle.guard';
import { AdminInviteThrottleGuard } from './guards/admin-invite-throttle.guard';

@Module({
  imports: [
    ExternalModule,
    TypeOrmModule.forFeature([BetaInvite, User]),
    BullModule.registerQueue({
      name: 'beta-access',
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  controllers: [AdminBetaController, BetaController],
  providers: [
    AdminGuard,
    RedeemThrottleGuard,
    AdminInviteThrottleGuard,
    BetaInviteService,
    BetaRedemptionService,
    BetaStatusService,
    BetaEntitlementService,
    BetaInviteEmailProcessor,
    BetaRedeemedEmailProcessor,
    BetaExpirySweepProcessor,
    BetaPostExpiryEmailProcessor,
  ],
  exports: [BetaEntitlementService],
})
export class BetaAccessModule implements OnModuleInit {
  private readonly logger = new Logger(BetaAccessModule.name);

  constructor(@InjectQueue('beta-access') private readonly betaQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    // Remove then re-add each repeatable job so re-deploys are idempotent.
    // Bull deduplicates by the cron expression; explicit removal prevents
    // stale schedule entries accumulating after cron string changes.

    await this.betaQueue.removeRepeatable('beta_expiry_sweep', {
      cron: '0 2 * * *',
    });
    await this.betaQueue.add(
      'beta_expiry_sweep',
      {},
      { repeat: { cron: '0 2 * * *' }, jobId: 'beta_expiry_sweep' },
    );
    this.logger.log(
      '[BetaAccessModule] Registered repeatable job: beta_expiry_sweep (02:00 UTC daily)',
    );

    await this.betaQueue.removeRepeatable('beta_post_expiry_email', {
      cron: '0 3 * * *',
    });
    await this.betaQueue.add(
      'beta_post_expiry_email',
      {},
      { repeat: { cron: '0 3 * * *' }, jobId: 'beta_post_expiry_email' },
    );
    this.logger.log(
      '[BetaAccessModule] Registered repeatable job: beta_post_expiry_email (03:00 UTC daily)',
    );

    await this.betaQueue.removeRepeatable('beta_invite_cleanup', {
      cron: '0 4 * * *',
    });
    await this.betaQueue.add(
      'beta_invite_cleanup',
      {},
      { repeat: { cron: '0 4 * * *' }, jobId: 'beta_invite_cleanup' },
    );
    this.logger.log(
      '[BetaAccessModule] Registered repeatable job: beta_invite_cleanup (04:00 UTC daily)',
    );
  }
}
