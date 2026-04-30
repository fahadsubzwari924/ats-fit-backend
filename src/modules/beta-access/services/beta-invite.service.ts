import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  BetaInvite,
  BetaInviteStatus,
} from '../../../database/entities/beta-invite.entity';
import { User } from '../../../database/entities/user.entity';
import { InviteBetaUsersDto } from '../dtos/invite-beta-users.dto';
import { AdminListQueryDto } from '../dtos/admin-list-query.dto';
import { normalizeEmail } from '../utils/email-normalize.util';
import { generateBetaCode } from '../utils/beta-code-generator.util';
import {
  DEFAULT_ACCESS_DAYS,
  DEFAULT_CODE_VALID_DAYS,
  DEFAULT_COHORT,
} from '../constants/beta-cohorts.constant';
import { BETA_ERRORS } from '../constants/beta-error-codes';

const MAX_CODE_RETRIES = 5;

@Injectable()
export class BetaInviteService {
  private readonly logger = new Logger(BetaInviteService.name);

  constructor(
    @InjectRepository(BetaInvite)
    private readonly betaInviteRepo: Repository<BetaInvite>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectQueue('beta-access')
    private readonly betaQueue: Queue,
  ) {}

  async createInvites(dto: InviteBetaUsersDto): Promise<{
    created: { email: string; code: string; expires_at: Date }[];
    skipped: { email: string; reason: string }[];
  }> {
    const normalized = dto.emails.map(normalizeEmail);

    // Detect duplicates within the request
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const email of normalized) {
      if (seen.has(email)) {
        duplicates.push(email);
      } else {
        seen.add(email);
      }
    }

    if (duplicates.length > 0) {
      throw new BadRequestException({
        message: BETA_ERRORS.DUPLICATE_IN_REQUEST,
        duplicates,
      });
    }

    const unique = Array.from(seen);
    const skipped: { email: string; reason: string }[] = [];
    const newInvites: BetaInvite[] = [];

    for (const email of unique) {
      const existing = await this.betaInviteRepo
        .createQueryBuilder('invite')
        .where('LOWER(invite.email) = :email', { email })
        .getOne();

      if (existing) {
        const reasonMap: Record<BetaInviteStatus, string> = {
          [BetaInviteStatus.PENDING]: 'ALREADY_INVITED',
          [BetaInviteStatus.REDEEMED]: 'ALREADY_REDEEMED',
          [BetaInviteStatus.EXPIRED]: 'ALREADY_EXPIRED',
          [BetaInviteStatus.REVOKED]: 'ALREADY_REVOKED',
        };
        skipped.push({ email, reason: reasonMap[existing.status] });
        continue;
      }

      let code: string | null = null;
      for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
        const candidate = generateBetaCode();
        const codeExists = await this.betaInviteRepo.findOne({
          where: { code: candidate },
        });
        if (!codeExists) {
          code = candidate;
          break;
        }
        this.logger.warn(
          `Code collision on attempt ${attempt + 1} for ${email}`,
        );
      }

      if (!code) {
        this.logger.error(`Failed to generate unique code for ${email} after ${MAX_CODE_RETRIES} retries`);
        skipped.push({ email, reason: 'CODE_GENERATION_FAILED' });
        continue;
      }

      const expiresAt = new Date(
        Date.now() +
          (dto.codeValidDays ?? DEFAULT_CODE_VALID_DAYS) * 86_400_000,
      );

      const invite = this.betaInviteRepo.create({
        email,
        code,
        code_expires_at: expiresAt,
        cohort: dto.cohort ?? DEFAULT_COHORT,
        access_days: dto.accessDays ?? DEFAULT_ACCESS_DAYS,
        status: BetaInviteStatus.PENDING,
      });

      newInvites.push(invite);
    }

    if (newInvites.length > 0) {
      await this.betaInviteRepo.save(newInvites);

      for (const invite of newInvites) {
        const existingUser = await this.userRepo.findOne({
          where: { email: invite.email },
          select: ['full_name'],
        });
        await this.betaQueue.add('beta_invite_email', {
          inviteId: invite.id,
          email: invite.email,
          name: existingUser?.full_name ?? undefined,
          code: invite.code,
          expiresAt: invite.code_expires_at,
        });
      }
    }

    return {
      created: newInvites.map((i) => ({
        email: i.email,
        code: i.code,
        expires_at: i.code_expires_at,
      })),
      skipped,
    };
  }

  async revokeInvite(
    id: string,
    reason: string,
    revokeActiveAccess: boolean,
  ): Promise<{ ok: true } | { message: string }> {
    const invite = await this.betaInviteRepo.findOne({ where: { id } });

    if (!invite) {
      throw new NotFoundException(BETA_ERRORS.CODE_NOT_FOUND);
    }

    if (invite.status === BetaInviteStatus.REVOKED) {
      return { message: 'already revoked' };
    }

    invite.status = BetaInviteStatus.REVOKED;
    invite.revoked_at = new Date();
    invite.revoked_reason = reason;
    await this.betaInviteRepo.save(invite);

    if (revokeActiveAccess && invite.redeemed_by_user_id) {
      const user = await this.userRepo.findOne({
        where: { id: invite.redeemed_by_user_id },
      });
      if (user) {
        user.beta_access_until = null;
        await this.userRepo.save(user);
      }
    }

    return { ok: true };
  }

  async findAllPaginated(query: AdminListQueryDto): Promise<{
    data: Omit<BetaInvite, 'code'>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Partial<Pick<BetaInvite, 'cohort' | 'status'>> = {};

    if (query.cohort) {
      where.cohort = query.cohort;
    }

    if (query.status) {
      where.status = query.status;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [raw, total] = await this.betaInviteRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    // Strip the raw invite code from every list record.
    // The code is only disclosed once — in the createInvites response and the
    // invite email. Returning it here would expose all codes to any admin
    // session that can read HTTP traffic or logs.
    const data: Omit<BetaInvite, 'code'>[] = raw.map(({ code: _code, ...rest }) => rest);

    return { data, total, page, limit };
  }
}
