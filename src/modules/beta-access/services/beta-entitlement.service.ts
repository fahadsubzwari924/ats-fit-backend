import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../database/entities/user.entity';

@Injectable()
export class BetaEntitlementService {
  private readonly logger = new Logger(BetaEntitlementService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async hasActiveBetaAccess(userId: string): Promise<boolean> {
    const user = await this.userRepo.findOne({
      where: { id: userId, is_beta_user: true },
      select: ['id', 'is_beta_user', 'beta_access_until'],
    });
    if (!user?.beta_access_until) return false;
    return user.beta_access_until > new Date();
  }
}
