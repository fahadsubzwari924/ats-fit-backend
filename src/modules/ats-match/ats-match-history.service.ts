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
  ): Promise<Partial<AtsMatchHistory>[]> {
    const queryBuilder =
      this.atsMatchHistoryRepository.createQueryBuilder('history');

    queryBuilder.where('history.user_id = :userId', { userId });

    if (fields?.length) {
      queryBuilder.select(fields.map((field) => `history.${field}`));
    }

    return queryBuilder.getMany();
  }
}
