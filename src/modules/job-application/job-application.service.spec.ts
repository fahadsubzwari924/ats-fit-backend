import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobApplicationService } from './job-application.service';
import {
  JobApplication,
  ApplicationStatus,
} from '../../database/entities/job-application.entity';
import { ResumeGeneration } from '../../database/entities/resume-generations.entity';
import { User } from '../../database/entities/user.entity';
import { FieldSelectionService } from '../../shared/services/field-selection.service';

describe('JobApplicationService', () => {
  let service: JobApplicationService;
  let createQueryBuilder: jest.Mock;
  let qb: {
    leftJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    getCount: jest.Mock;
    getMany: jest.Mock;
  };

  const userId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
    };
    createQueryBuilder = jest.fn().mockReturnValue(qb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobApplicationService,
        {
          provide: getRepositoryToken(JobApplication),
          useValue: { createQueryBuilder },
        },
        { provide: getRepositoryToken(ResumeGeneration), useValue: {} },
        { provide: getRepositoryToken(User), useValue: {} },
        {
          provide: FieldSelectionService,
          useValue: {
            applyFieldSelection: jest.fn(),
            filterResponseFields: jest.fn((rows: unknown) => rows),
          },
        },
      ],
    }).compile();

    service = module.get(JobApplicationService);
  });

  describe('getJobApplications', () => {
    it('adds ILIKE search when q is set', async () => {
      await service.getJobApplications({
        user_id: userId,
        q: 'acme',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(jobApplication.company_name ILIKE :qSearch OR jobApplication.job_position ILIKE :qSearch)',
        { qSearch: '%acme%' },
      );
    });

    it('uses IN binding for statuses when statuses is non-empty', async () => {
      await service.getJobApplications({
        user_id: userId,
        statuses: [ApplicationStatus.APPLIED],
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'jobApplication.status IN (:...statuses)',
        { statuses: [ApplicationStatus.APPLIED] },
      );
    });
  });
});
