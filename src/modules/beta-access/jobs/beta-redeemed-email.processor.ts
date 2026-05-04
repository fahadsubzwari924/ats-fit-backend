import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { BrevoService } from '../../../shared/modules/external/services/brevo.service';

interface BetaRedeemedEmailJobData {
  userId: string;
  email: string;
  name?: string;
  betaAccessUntil: Date;
}

@Processor('beta-access')
export class BetaRedeemedEmailProcessor {
  private readonly logger = new Logger(BetaRedeemedEmailProcessor.name);

  constructor(
    private readonly brevoService: BrevoService,
    private readonly configService: ConfigService,
  ) {}

  @Process('beta_redeemed_email')
  async handleBetaRedeemedEmail(
    job: Job<BetaRedeemedEmailJobData>,
  ): Promise<void> {
    const { userId, email, name, betaAccessUntil } = job.data;

    this.logger.log(
      `Processing beta_redeemed_email job ${job.id} for user ${userId}`,
    );

    const templateId = this.configService.get<number>(
      'BREVO_TEMPLATE_ID_BETA_REDEEMED_WELCOME',
    );
    if (!templateId) {
      this.logger.warn(
        `BREVO_TEMPLATE_ID_BETA_REDEEMED_WELCOME not configured — skipping email for user ${userId}`,
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
          beta_access_until: new Date(betaAccessUntil).toDateString(),
          dashboard_url: `${frontendUrl}/dashboard`,
        },
      });

      this.logger.log(
        `Beta redeemed welcome email sent to ${email} (user: ${userId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send beta redeemed welcome email to ${email} (user: ${userId})`,
        {
          error: (error as Error).message,
          jobId: job.id,
        },
      );
      throw error;
    }
  }
}
