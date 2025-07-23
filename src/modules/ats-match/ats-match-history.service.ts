import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AtsMatchHistory } from '../../database/entities/ats-match-history.entity';

@Injectable()
export class AtsMatchHistoryService {
  constructor(
    @InjectRepository(AtsMatchHistory)
    private readonly atsMatchHistoryRepository: Repository<AtsMatchHistory>,
  ) {}

  async getAtsMatchHistoryByUserId(
    userId: string,
    fields?: string[],
    allowedDays?: number,
  ): Promise<Partial<AtsMatchHistory>[]> {
    const queryBuilder =
      this.atsMatchHistoryRepository.createQueryBuilder('history');

    queryBuilder.where('history.user_id = :userId', { userId });

    if (allowedDays) {
      const cutoffDate = new Date(
        new Date().getTime() - allowedDays * 24 * 60 * 60 * 1000,
      );
      queryBuilder.andWhere('history.created_at >= :cutoffDate', {
        cutoffDate,
      });
    }

    if (fields?.length) {
      queryBuilder.select(fields.map((field) => `history.${field}`));
    }

    return queryBuilder.getMany();
  }
}
