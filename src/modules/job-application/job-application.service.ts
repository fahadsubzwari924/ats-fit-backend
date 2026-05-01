import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  JobApplication,
  ApplicationStatus,
} from '../../database/entities/job-application.entity';
import { ResumeGeneration } from '../../database/entities/resume-generations.entity';
import { User } from '../../database/entities/user.entity';
import {
  ICreateJobApplication,
  IUpdateJobApplication,
  IJobApplicationQuery,
  IJobApplicationStats,
  IJobApplicationWithRelations,
  IJobApplicationMetadata,
} from './interfaces/job-application.interface';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { FieldSelectionService } from '../../shared/services/field-selection.service';
import { JOB_APPLICATION_FIELD_CONFIG } from './config/field-selection.config';
import { resolveAppliedAtOnCreate } from './utils/resolve-applied-at-on-create';
import { appendStatusHistoryIfChanged } from './services/job-application-status-history.helper';
import type { IJobApplicationStatusHistoryEntry } from './interfaces/job-application-status-history.interface';

const JOB_APPLICATION_LIST_SORT_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'company_name',
  'job_position',
  'status',
  'applied_at',
  'application_deadline',
  'follow_up_date',
  'decision_deadline',
  'priority',
  'work_mode',
  'employment_type',
  'job_board_source',
]);

function appendNullableDateRange(
  qb: SelectQueryBuilder<JobApplication>,
  columnPath: string,
  from: string | undefined,
  to: string | undefined,
  paramKeys: { from: string; to: string },
): void {
  if (!from && !to) return;
  qb.andWhere(`${columnPath} IS NOT NULL`);
  if (from && to) {
    qb.andWhere(
      `${columnPath} BETWEEN :${paramKeys.from} AND :${paramKeys.to}`,
      { [paramKeys.from]: from, [paramKeys.to]: to },
    );
    return;
  }
  if (from) {
    qb.andWhere(`${columnPath} >= :${paramKeys.from}`, {
      [paramKeys.from]: from,
    });
    return;
  }
  qb.andWhere(`${columnPath} <= :${paramKeys.to}`, {
    [paramKeys.to]: to,
  });
}

@Injectable()
export class JobApplicationService {
  private readonly logger = new Logger(JobApplicationService.name);

  constructor(
    @InjectRepository(JobApplication)
    private readonly jobApplicationRepository: Repository<JobApplication>,
    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly fieldSelectionService: FieldSelectionService,
  ) {}

  /**
   * Create a new job application record
   */
  async createJobApplication(
    data: ICreateJobApplication,
  ): Promise<JobApplication> {
    try {
      this.logger.log(
        `Creating job application for ${data.company_name} - ${data.job_position}`,
      );

      // Validate create job application request
      await this.validateCreateJobApplicationRequest(data);

      // Create job application entity
      const initialStatus = data.status ?? ApplicationStatus.APPLIED;
      const initialHistory: IJobApplicationStatusHistoryEntry[] = [
        {
          from: null,
          to: initialStatus,
          changed_at: new Date().toISOString(),
          changed_by_user_id: data.user_id,
        },
      ];

      const jobApplication = this.jobApplicationRepository.create({
        user_id: data.user_id,
        company_name: data.company_name,
        job_position: data.job_position,
        job_description: data.job_description,
        application_source: data.application_source,
        status: initialStatus,
        applied_at: resolveAppliedAtOnCreate(data),
        resume_generation_id: data.resume_generation_id,
        resume_content: data.resume_content,
        job_url: data.job_url,
        job_location: data.job_location,
        employment_type: data.employment_type,
        work_mode: data.work_mode,
        salary_min: data.salary_min,
        salary_max: data.salary_max,
        salary_currency: data.salary_currency,
        pay_period: data.pay_period,
        salary_negotiable: data.salary_negotiable,
        job_board_source: data.job_board_source,
        applied_via: data.applied_via,
        priority: data.priority,
        tags: data.tags,
        application_deadline: data.application_deadline
          ? new Date(data.application_deadline as string)
          : undefined,
        decision_deadline: data.decision_deadline
          ? new Date(data.decision_deadline as string)
          : undefined,
        next_action: data.next_action,
        recruiter_name: data.recruiter_name,
        recruiter_email: data.recruiter_email,
        recruiter_phone: data.recruiter_phone,
        hiring_manager_name: data.hiring_manager_name,
        hiring_manager_email: data.hiring_manager_email,
        contact_phone: data.contact_phone,
        contacts: data.contacts,
        cover_letter: data.cover_letter,
        notes: data.notes,
        attachments: data.attachments,
        status_history: initialHistory,
        metadata: this.buildJobApplicationMetadata(
          data.metadata,
          data.resume_content,
        ),
      });

      const savedJobApplication =
        await this.jobApplicationRepository.save(jobApplication);

      this.logger.log(
        `Job application created successfully with ID: ${savedJobApplication.id}`,
      );
      return savedJobApplication;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error('Error creating job application:', error);
      throw new BadRequestException(
        'Failed to create job application',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Get job applications with filtering and pagination
   */
  /**
   * Get job applications with optional field selection
   */
  async getJobApplications(
    query: IJobApplicationQuery,
  ): Promise<{ applications: IJobApplicationWithRelations[]; total: number }> {
    try {
      this.logger.log('Fetching job applications with query:', query);

      const queryBuilder = this.buildJobApplicationQuery(query);

      // Apply field selection if specified
      if (query.fields && query.fields.length > 0) {
        this.fieldSelectionService.applyFieldSelection(
          queryBuilder,
          query.fields,
          JOB_APPLICATION_FIELD_CONFIG,
        );
      }

      // Get total count (before applying limits)
      const total = await queryBuilder.getCount();

      // Apply pagination
      if (query.limit) {
        queryBuilder.limit(query.limit);
      }
      if (query.offset) {
        queryBuilder.offset(query.offset);
      }

      // Get applications
      const applications = await queryBuilder.getMany();

      // Filter response fields if field selection is specified
      let filteredApplications = applications;
      if (query.fields && query.fields.length > 0) {
        filteredApplications = this.fieldSelectionService.filterResponseFields(
          applications,
          query.fields,
          JOB_APPLICATION_FIELD_CONFIG,
        ) as IJobApplicationWithRelations[];
      }

      this.logger.log(`Found ${filteredApplications.length} job applications`);
      return { applications: filteredApplications, total };
    } catch (error) {
      this.logger.error('Error fetching job applications:', error);
      throw new BadRequestException(
        'Failed to fetch job applications',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Get a single job application by ID with optional field selection
   */
  async getJobApplicationById(
    id: string,
    userContext: { userId?: string },
    fields?: string[],
  ): Promise<IJobApplicationWithRelations> {
    try {
      this.logger.log(`Fetching job application with ID: ${id}`);

      const queryBuilder = this.jobApplicationRepository
        .createQueryBuilder('jobApplication')
        .leftJoinAndSelect(
          'jobApplication.resume_generation',
          'resume_generation',
        )
        .leftJoinAndSelect('jobApplication.user', 'user')
        .where('jobApplication.id = :id', { id });

      // Apply field selection if specified
      if (fields && fields.length > 0) {
        this.fieldSelectionService.applyFieldSelection(
          queryBuilder,
          fields,
          JOB_APPLICATION_FIELD_CONFIG,
        );
      }

      if (!userContext.userId) {
        throw new ForbiddenException('Access denied', ERROR_CODES.FORBIDDEN);
      }
      queryBuilder.andWhere('jobApplication.user_id = :userId', {
        userId: userContext.userId,
      });

      const application = await queryBuilder.getOne();

      if (!application) {
        throw new NotFoundException(
          'Job application not found',
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Filter response fields if field selection is specified
      let filteredApplication = application;
      if (fields && fields.length > 0) {
        filteredApplication = this.fieldSelectionService.filterResponseFields(
          application,
          fields,
          JOB_APPLICATION_FIELD_CONFIG,
        ) as IJobApplicationWithRelations;
      }

      this.logger.log(`Job application found: ${filteredApplication.id}`);
      return filteredApplication;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error('Error fetching job application:', error);
      throw new BadRequestException(
        'Failed to fetch job application',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Update a job application
   */
  async updateJobApplication(
    id: string,
    data: IUpdateJobApplication,
    userContext: { userId?: string },
  ): Promise<JobApplication> {
    try {
      this.logger.log(`Updating job application with ID: ${id}`);
      const application = await this.getJobApplicationById(id, userContext);

      const nextStatusHistory = appendStatusHistoryIfChanged(
        application,
        data.status,
        userContext.userId,
      );

      const mergedMetadata = data.metadata
        ? { ...(application.metadata ?? {}), ...data.metadata }
        : application.metadata;

      const dateFields: Partial<JobApplication> = {};
      if (data.applied_at)
        dateFields.applied_at = new Date(data.applied_at as string);
      if (data.application_deadline)
        dateFields.application_deadline = new Date(
          data.application_deadline as string,
        );
      if (data.decision_deadline)
        dateFields.decision_deadline = new Date(
          data.decision_deadline as string,
        );
      if (data.interview_scheduled_at)
        dateFields.interview_scheduled_at = new Date(
          data.interview_scheduled_at as string,
        );
      if (data.follow_up_date)
        dateFields.follow_up_date = new Date(data.follow_up_date as string);

      Object.assign(application, {
        ...data,
        ...dateFields,
        metadata: mergedMetadata,
        status_history: nextStatusHistory,
      });

      const updatedApplication =
        await this.jobApplicationRepository.save(application);
      this.logger.log(`Job application updated successfully: ${id}`);
      return updatedApplication;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error('Error updating job application:', error);
      throw new BadRequestException(
        'Failed to update job application',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Delete a job application
   */
  async deleteJobApplication(
    id: string,
    userContext: { userId?: string },
  ): Promise<void> {
    try {
      this.logger.log(`Deleting job application with ID: ${id}`);

      // Find and validate ownership
      await this.getJobApplicationById(id, userContext);

      await this.jobApplicationRepository.delete(id);

      this.logger.log(`Job application deleted successfully: ${id}`);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error('Error deleting job application:', error);
      throw new BadRequestException(
        'Failed to delete job application',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Get job application statistics
   */
  async getJobApplicationStats(userContext: {
    userId?: string;
  }): Promise<IJobApplicationStats> {
    try {
      this.logger.log('Generating job application statistics');

      const queryBuilder = this.jobApplicationRepository
        .createQueryBuilder('ja')
        .where('1 = 1');

      if (userContext.userId) {
        queryBuilder.andWhere('ja.user_id = :userId', {
          userId: userContext.userId,
        });
      }

      const applications = await queryBuilder.getMany();

      // Calculate statistics
      const stats: IJobApplicationStats = {
        total_applications: applications.length,
        applications_by_status: this.calculateStatusStats(applications),
        response_rate: this.calculateResponseRate(applications),
        interview_rate: this.calculateInterviewRate(applications),
        success_rate: this.calculateSuccessRate(applications),
        top_companies: this.calculateTopCompanies(applications),
        monthly_trend: this.calculateMonthlyTrend(applications),
      };

      this.logger.log('Job application statistics generated successfully');
      return stats;
    } catch (error) {
      this.logger.error('Error generating statistics:', error);
      throw new BadRequestException(
        'Failed to generate statistics',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  private async validateCreateJobApplicationRequest(
    payload: ICreateJobApplication,
  ): Promise<void> {
    if (!payload.user_id) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.user_id },
    });
    if (!user) {
      throw new NotFoundException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Validate resume generation exists if provided
    if (payload.resume_generation_id) {
      const resumeGeneration = await this.resumeGenerationRepository.findOne({
        where: { id: payload.resume_generation_id },
      });
      if (!resumeGeneration) {
        throw new NotFoundException(
          'Resume generation record not found',
          ERROR_CODES.NOT_FOUND,
        );
      }
    }
  }

  /**
   * Build query for job applications with filters
   */
  private buildJobApplicationQuery(
    query: IJobApplicationQuery,
  ): SelectQueryBuilder<JobApplication> {
    const queryBuilder = this.jobApplicationRepository
      .createQueryBuilder('jobApplication')
      .leftJoinAndSelect(
        'jobApplication.resume_generation',
        'resume_generation',
      );

    if (query.user_id) {
      queryBuilder.where('jobApplication.user_id = :userId', {
        userId: query.user_id,
      });
    }

    if (query.statuses?.length) {
      queryBuilder.andWhere('jobApplication.status IN (:...statuses)', {
        statuses: query.statuses,
      });
    } else if (query.status) {
      queryBuilder.andWhere('jobApplication.status = :status', {
        status: query.status,
      });
    }

    const qTrimmed = query.q?.trim();
    if (qTrimmed) {
      queryBuilder.andWhere(
        '(jobApplication.company_name ILIKE :qSearch OR jobApplication.job_position ILIKE :qSearch)',
        { qSearch: `%${qTrimmed}%` },
      );
    }

    if (query.company_name) {
      queryBuilder.andWhere('jobApplication.company_name ILIKE :companyName', {
        companyName: `%${query.company_name}%`,
      });
    }

    if (query.job_board_source) {
      queryBuilder.andWhere('jobApplication.job_board_source = :jbs', {
        jbs: query.job_board_source,
      });
    }
    if (query.work_mode) {
      queryBuilder.andWhere('jobApplication.work_mode = :wm', {
        wm: query.work_mode,
      });
    }
    if (query.employment_type) {
      queryBuilder.andWhere('jobApplication.employment_type = :et', {
        et: query.employment_type,
      });
    }
    if (query.priority) {
      queryBuilder.andWhere('jobApplication.priority = :pri', {
        pri: query.priority,
      });
    }
    if (query.tag) {
      queryBuilder.andWhere(':tag = ANY(jobApplication.tags)', {
        tag: query.tag,
      });
    }

    appendNullableDateRange(
      queryBuilder,
      'jobApplication.applied_at',
      query.applied_at_from,
      query.applied_at_to,
      { from: 'appliedAtFrom', to: 'appliedAtTo' },
    );
    appendNullableDateRange(
      queryBuilder,
      'jobApplication.application_deadline',
      query.deadline_from,
      query.deadline_to,
      { from: 'deadlineFrom', to: 'deadlineTo' },
    );
    appendNullableDateRange(
      queryBuilder,
      'jobApplication.follow_up_date',
      query.follow_up_from,
      query.follow_up_to,
      { from: 'followUpFrom', to: 'followUpTo' },
    );
    appendNullableDateRange(
      queryBuilder,
      'jobApplication.decision_deadline',
      query.decision_deadline_from,
      query.decision_deadline_to,
      { from: 'decisionDeadlineFrom', to: 'decisionDeadlineTo' },
    );

    const sortColumn =
      query.sort_by && JOB_APPLICATION_LIST_SORT_COLUMNS.has(query.sort_by)
        ? query.sort_by
        : 'created_at';
    const sortOrder = query.sort_order === 'ASC' ? 'ASC' : 'DESC';
    queryBuilder.orderBy(`jobApplication.${sortColumn}`, sortOrder);

    return queryBuilder;
  }

  /**
   * Build job application metadata with type safety
   */
  private buildJobApplicationMetadata(
    existingMetadata?: IJobApplicationMetadata,
    resumeContent?: string,
  ): IJobApplicationMetadata {
    return {
      ...existingMetadata,
      resume_content_provided: Boolean(resumeContent),
    };
  }

  /**
   * Calculate statistics helper methods
   */
  private calculateStatusStats(
    applications: JobApplication[],
  ): Record<ApplicationStatus, number> {
    const stats: Record<ApplicationStatus, number> = {} as Record<
      ApplicationStatus,
      number
    >;

    Object.values(ApplicationStatus).forEach((status) => {
      stats[status] = applications.filter(
        (app) => app.status === status,
      ).length;
    });

    return stats;
  }

  private calculateResponseRate(applications: JobApplication[]): number {
    const appliedApplications = applications.filter(
      (app) => app.status !== ApplicationStatus.APPLIED,
    );
    if (appliedApplications.length === 0) return 0;

    const responsesReceived = applications.filter(
      (app) =>
        ![ApplicationStatus.APPLIED, ApplicationStatus.SCREENING].includes(
          app.status,
        ),
    );

    return (
      Math.round(
        (responsesReceived.length / appliedApplications.length) * 100 * 100,
      ) / 100
    );
  }

  private calculateInterviewRate(applications: JobApplication[]): number {
    const appliedApplications = applications.filter(
      (app) => app.status !== ApplicationStatus.APPLIED,
    );
    if (appliedApplications.length === 0) return 0;

    const interviewApplications = applications.filter((app) =>
      [
        ApplicationStatus.SCREENING,
        ApplicationStatus.INTERVIEWED,
        ApplicationStatus.OFFER_RECEIVED,
        ApplicationStatus.ACCEPTED,
      ].includes(app.status),
    );

    return (
      Math.round(
        (interviewApplications.length / appliedApplications.length) * 100 * 100,
      ) / 100
    );
  }

  private calculateSuccessRate(applications: JobApplication[]): number {
    const appliedApplications = applications.filter(
      (app) => app.status !== ApplicationStatus.APPLIED,
    );
    if (appliedApplications.length === 0) return 0;

    const successfulApplications = applications.filter((app) =>
      [ApplicationStatus.OFFER_RECEIVED, ApplicationStatus.ACCEPTED].includes(
        app.status,
      ),
    );

    return (
      Math.round(
        (successfulApplications.length / appliedApplications.length) *
          100 *
          100,
      ) / 100
    );
  }

  private calculateTopCompanies(
    applications: JobApplication[],
  ): Array<{ company_name: string; application_count: number }> {
    const companyCount: Record<string, number> = {};

    applications.forEach((app) => {
      companyCount[app.company_name] =
        (companyCount[app.company_name] || 0) + 1;
    });

    return Object.entries(companyCount)
      .map(([company_name, application_count]) => ({
        company_name,
        application_count,
      }))
      .sort((a, b) => b.application_count - a.application_count)
      .slice(0, 10);
  }

  private calculateMonthlyTrend(
    applications: JobApplication[],
  ): Array<{ month: string; count: number }> {
    const monthlyCount: Record<string, number> = {};

    applications.forEach((app) => {
      const month = app.created_at.toISOString().slice(0, 7); // YYYY-MM format
      monthlyCount[month] = (monthlyCount[month] || 0) + 1;
    });

    return Object.entries(monthlyCount)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12); // Last 12 months
  }
}
