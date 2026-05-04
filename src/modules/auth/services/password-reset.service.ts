import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User, RegistrationType } from '../../../database/entities/user.entity';
import { PasswordResetToken } from '../../../database/entities/password-reset-token.entity';
import { BrevoService } from '../../../shared/modules/external/services/brevo.service';
import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 3;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly passwordResetTemplateId: number;
  private readonly passwordChangedTemplateId: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepository: Repository<PasswordResetToken>,
    private readonly brevoService: BrevoService,
    private readonly configService: ConfigService,
  ) {
    this.passwordResetTemplateId =
      this.configService.get<number>('BREVO_TEMPLATE_ID_PASSWORD_RESET') ?? 0;
    this.passwordChangedTemplateId =
      this.configService.get<number>('BREVO_TEMPLATE_ID_PASSWORD_CHANGED') ?? 0;
    if (!this.passwordResetTemplateId) {
      this.logger.warn('BREVO_TEMPLATE_ID_PASSWORD_RESET is not configured');
    }
    if (!this.passwordChangedTemplateId) {
      this.logger.warn('BREVO_TEMPLATE_ID_PASSWORD_CHANGED is not configured');
    }
  }

  async requestPasswordReset(email: string, ipAddress?: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase().trim(), is_active: true },
      select: ['id', 'email', 'full_name', 'registration_type'],
    });

    // Silent exit — never reveal whether an email exists or is Google-only
    if (!user || user.registration_type !== RegistrationType.GENERAL) {
      return;
    }

    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:4200',
    );

    // Rate limit + token lifecycle wrapped in a serializable transaction to prevent races
    let plainToken!: string;
    let shouldSend = false;

    await this.resetTokenRepository.manager.transaction(async (manager) => {
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
      // COUNT(*) + FOR UPDATE is invalid in PostgreSQL; select IDs with the lock instead
      const recentTokens = await manager
        .createQueryBuilder(PasswordResetToken, 'token')
        .select('token.id')
        .where('token.user_id = :userId', { userId: user.id })
        .andWhere('token.created_at > :since', { since: windowStart })
        .setLock('pessimistic_write')
        .getMany();
      const recentCount = recentTokens.length;

      if (recentCount >= RATE_LIMIT_MAX_REQUESTS) {
        this.logger.warn(`Password reset rate limit hit for userId=${user.id}`);
        return;
      }

      await manager.delete(PasswordResetToken, { user_id: user.id });

      plainToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto
        .createHash('sha256')
        .update(plainToken)
        .digest('hex');
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

      const tokenRecord = manager.create(PasswordResetToken, {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        ip_address: ipAddress ?? null,
      });
      await manager.save(PasswordResetToken, tokenRecord);
      shouldSend = true;
    });

    if (!shouldSend) return;

    const resetLink = `${frontendUrl}/reset-password?token=${plainToken}`;

    try {
      await this.brevoService.sendTransactionalEmail({
        to: [{ email: user.email, name: user.full_name }],
        templateId: this.passwordResetTemplateId,
        params: {
          userName: user.full_name,
          resetLink,
          expiresIn: '1 hour',
        },
      });
      this.logger.log(`Password reset email sent for userId=${user.id}`);
    } catch (err) {
      this.logger.error(
        `Failed to send password reset email for userId=${user.id}`,
        (err as Error).message,
      );
      await this.resetTokenRepository.delete({ user_id: user.id });
    }
  }

  async validateResetToken(
    plainToken: string,
  ): Promise<{ valid: boolean; emailHint?: string; reason?: string }> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');

    const tokenRecord = await this.resetTokenRepository.findOne({
      where: { token_hash: tokenHash },
      relations: ['user'],
    });

    if (!tokenRecord) return { valid: false, reason: 'not_found' };
    if (tokenRecord.used_at) return { valid: false, reason: 'used' };
    if (new Date() > tokenRecord.expires_at)
      return { valid: false, reason: 'expired' };

    const [localPart, domain] = tokenRecord.user.email.split('@');
    const emailHint = `${localPart[0]}***@${domain}`;

    return { valid: true, emailHint };
  }

  async resetPassword(plainToken: string, newPassword: string): Promise<void> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');

    // Fast pre-check: avoid entering a transaction for clearly invalid tokens
    const preCheck = await this.resetTokenRepository.findOne({
      where: { token_hash: tokenHash },
    });
    if (!preCheck) {
      throw new BadRequestException(
        'Password reset link is invalid or has expired.',
        ERROR_CODES.INVALID_RESET_TOKEN,
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Variables to carry data out of the transaction for post-commit work
    let confirmedUserId: string = '';
    let confirmedUser: User = null!;

    await this.resetTokenRepository.manager.transaction(async (manager) => {
      // Re-fetch with exclusive lock to prevent concurrent redemption
      // innerJoinAndSelect required — FOR UPDATE cannot be applied to the nullable side of a LEFT JOIN
      const tokenRecord = await manager
        .createQueryBuilder(PasswordResetToken, 'token')
        .innerJoinAndSelect('token.user', 'user')
        .where('token.token_hash = :hash', { hash: tokenHash })
        .setLock('pessimistic_write')
        .getOne();

      if (
        !tokenRecord ||
        tokenRecord.used_at ||
        new Date() > tokenRecord.expires_at
      ) {
        throw new BadRequestException(
          'Password reset link is invalid or has expired.',
          ERROR_CODES.INVALID_RESET_TOKEN,
        );
      }

      tokenRecord.used_at = new Date();
      await manager.save(PasswordResetToken, tokenRecord);
      await manager.update(User, tokenRecord.user_id, {
        password: hashedPassword,
      });

      confirmedUserId = tokenRecord.user_id;
      confirmedUser = tokenRecord.user;
    });

    // Send confirmation email after transaction commits (best-effort)
    try {
      await this.brevoService.sendTransactionalEmail({
        to: [{ email: confirmedUser.email, name: confirmedUser.full_name }],
        templateId: this.passwordChangedTemplateId,
        params: {
          userName: confirmedUser.full_name,
          changedAt: new Date().toUTCString(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send password-changed confirmation for userId=${confirmedUserId}`,
        (err as Error).message,
      );
    }

    this.logger.log(`Password reset successful for userId=${confirmedUserId}`);
  }
}
