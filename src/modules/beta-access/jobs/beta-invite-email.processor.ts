import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { BrevoService } from '../../../shared/modules/external/services/brevo.service';

interface BetaInviteEmailJobData {
  inviteId: string;
  email: string;
  name?: string;
  code: string;
  expiresAt: Date;
}

@Processor('beta-access')
export class BetaInviteEmailProcessor {
  private readonly logger = new Logger(BetaInviteEmailProcessor.name);

  constructor(
    private readonly brevoService: BrevoService,
    private readonly configService: ConfigService,
  ) {}

  @Process('beta_invite_email')
  async handleBetaInviteEmail(job: Job<BetaInviteEmailJobData>): Promise<void> {
    const { inviteId, email, name, code, expiresAt } = job.data;

    this.logger.log(
      `Processing beta_invite_email job ${job.id} for invite ${inviteId}`,
    );

    const templateId = this.configService.get<number>(
      'BREVO_TEMPLATE_ID_BETA_INVITE',
    );
    if (!templateId) {
      this.logger.warn(
        `BREVO_TEMPLATE_ID_BETA_INVITE not configured — skipping email for invite ${inviteId}`,
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
          code,
          expires_at: new Date(expiresAt).toDateString(),
          redeem_url: `${frontendUrl}/beta/redeem?code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`,
        },
      });

      this.logger.log(
        `Beta invite email sent to ${email} (invite: ${inviteId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send beta invite email to ${email} (invite: ${inviteId})`,
        {
          error: (error as Error).message,
          jobId: job.id,
        },
      );
      throw error;
    }
  }
}
