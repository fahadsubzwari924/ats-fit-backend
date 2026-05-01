import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobApplication } from '../../../database/entities/job-application.entity';
import { JobApplicationInterview } from '../../../database/entities/job-application-interview.entity';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import {
  CreateJobApplicationInterviewDto,
  UpdateJobApplicationInterviewDto,
} from '../dtos/job-application-interview.dto';

@Injectable()
export class JobApplicationInterviewService {
  private readonly logger = new Logger(JobApplicationInterviewService.name);

  constructor(
    @InjectRepository(JobApplicationInterview)
    private readonly interviewRepository: Repository<JobApplicationInterview>,
    @InjectRepository(JobApplication)
    private readonly jobApplicationRepository: Repository<JobApplication>,
  ) {}

  async listInterviews(
    jobApplicationId: string,
    userId: string,
  ): Promise<JobApplicationInterview[]> {
    await this.assertOwnership(jobApplicationId, userId);
    return this.interviewRepository.find({
      where: { job_application_id: jobApplicationId },
      order: { scheduled_at: 'ASC', created_at: 'ASC' },
    });
  }

  async createInterview(
    jobApplicationId: string,
    userId: string,
    dto: CreateJobApplicationInterviewDto,
  ): Promise<JobApplicationInterview> {
    await this.assertOwnership(jobApplicationId, userId);
    const interview = this.interviewRepository.create({
      job_application_id: jobApplicationId,
      ...dto,
      scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : undefined,
      completed_at: dto.completed_at ? new Date(dto.completed_at) : undefined,
    });
    return this.interviewRepository.save(interview);
  }

  async updateInterview(
    jobApplicationId: string,
    interviewId: string,
    userId: string,
    dto: UpdateJobApplicationInterviewDto,
  ): Promise<JobApplicationInterview> {
    await this.assertOwnership(jobApplicationId, userId);
    const interview = await this.findChildOrThrow(
      jobApplicationId,
      interviewId,
    );
    Object.assign(interview, {
      ...dto,
      scheduled_at: dto.scheduled_at
        ? new Date(dto.scheduled_at)
        : interview.scheduled_at,
      completed_at: dto.completed_at
        ? new Date(dto.completed_at)
        : interview.completed_at,
    });
    return this.interviewRepository.save(interview);
  }

  async deleteInterview(
    jobApplicationId: string,
    interviewId: string,
    userId: string,
  ): Promise<void> {
    await this.assertOwnership(jobApplicationId, userId);
    const interview = await this.findChildOrThrow(
      jobApplicationId,
      interviewId,
    );
    await this.interviewRepository.delete(interview.id);
  }

  private async assertOwnership(
    jobApplicationId: string,
    userId: string,
  ): Promise<void> {
    if (!userId) {
      throw new ForbiddenException('Access denied', ERROR_CODES.FORBIDDEN);
    }
    const parent = await this.jobApplicationRepository.findOne({
      where: { id: jobApplicationId, user_id: userId },
    });
    if (!parent) {
      throw new NotFoundException(
        'Job application not found',
        ERROR_CODES.NOT_FOUND,
      );
    }
  }

  private async findChildOrThrow(
    jobApplicationId: string,
    interviewId: string,
  ): Promise<JobApplicationInterview> {
    const interview = await this.interviewRepository.findOne({
      where: { id: interviewId, job_application_id: jobApplicationId },
    });
    if (!interview) {
      throw new NotFoundException('Interview not found', ERROR_CODES.NOT_FOUND);
    }
    return interview;
  }
}
