/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
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
import { AtsMatchHistory } from '../../database/entities/ats-match-history.entity';
import { ResumeGeneration } from '../../database/entities/resume-generations.entity';
import { User } from '../../database/entities/user.entity';
import {
  ICreateJobApplication,
  IUpdateJobApplication,
  IJobApplicationQuery,
  IJobApplicationStats,
  IJobApplicationWithRelations,
} from './interfaces/job-application.interface';
import { AtsMatchService } from '../ats-match/ats-match.service';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { FieldSelectionService } from '../../shared/services/field-selection.service';
import { JOB_APPLICATION_FIELD_CONFIG } from './config/field-selection.config';

@Injectable()
export class JobApplicationService {
  private readonly logger = new Logger(JobApplicationService.name);

  constructor(
    @InjectRepository(JobApplication)
    private readonly jobApplicationRepository: Repository<JobApplication>,
    @InjectRepository(AtsMatchHistory)
    private readonly atsMatchHistoryRepository: Repository<AtsMatchHistory>,
    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly atsMatchService: AtsMatchService,
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
      const jobApplication = this.jobApplicationRepository.create({
        user_id: data.user_id,
        guest_id: data.guest_id,
        company_name: data.company_name,
        job_position: data.job_position,
        job_description: data.job_description,
        application_source: data.application_source,
        ats_match_history_id: data.ats_match_history_id,
        resume_generation_id: data.resume_generation_id,
        ats_score: data.ats_score,
        ats_analysis: data.ats_analysis,
        resume_content: data.resume_content,
        job_url: data.job_url,
        job_location: data.job_location,
        current_salary: data.current_salary,
        expected_salary: data.expected_salary,
        application_deadline: data.application_deadline,
        cover_letter: data.cover_letter,
        notes: data.notes,
        contact_phone: data.contact_phone,
        metadata: {
          ...data.metadata,
          skills_matched: data.ats_analysis?.matched?.hardSkills || [],
          skills_missing: data.ats_analysis?.missingKeywords || [],
        },
        status: ApplicationStatus.APPLIED,
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
    userContext: { userId?: string; guestId?: string },
    fields?: string[],
  ): Promise<IJobApplicationWithRelations> {
    try {
      this.logger.log(`Fetching job application with ID: ${id}`);

      const queryBuilder = this.jobApplicationRepository
        .createQueryBuilder('jobApplication')
        .leftJoinAndSelect(
          'jobApplication.ats_match_history',
          'ats_match_history',
        )
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

      // Add user/guest context filter
      if (userContext.userId) {
        queryBuilder.andWhere('jobApplication.user_id = :userId', {
          userId: userContext.userId,
        });
      } else if (userContext.guestId) {
        queryBuilder.andWhere('jobApplication.guest_id = :guestId', {
          guestId: userContext.guestId,
        });
      } else {
        throw new ForbiddenException('Access denied', ERROR_CODES.FORBIDDEN);
      }

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
    userContext: { userId?: string; guestId?: string },
  ): Promise<JobApplication> {
    try {
      this.logger.log(`Updating job application with ID: ${id}`);

      // Find and validate ownership
      const application = await this.getJobApplicationById(id, userContext);

      // Update fields
      Object.assign(application, {
        ...data,
        ...(data.applied_at && { applied_at: new Date(data.applied_at) }),
        ...(data.interview_scheduled_at && {
          interview_scheduled_at: new Date(data.interview_scheduled_at),
        }),
        ...(data.follow_up_date && {
          follow_up_date: new Date(data.follow_up_date),
        }),
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
    userContext: { userId?: string; guestId?: string },
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
    guestId?: string;
  }): Promise<IJobApplicationStats> {
    try {
      this.logger.log('Generating job application statistics');

      const queryBuilder = this.jobApplicationRepository
        .createQueryBuilder('ja')
        .where('1 = 1');

      // Add user/guest context filter
      if (userContext.userId) {
        queryBuilder.andWhere('ja.user_id = :userId', {
          userId: userContext.userId,
        });
      } else if (userContext.guestId) {
        queryBuilder.andWhere('ja.guest_id = :guestId', {
          guestId: userContext.guestId,
        });
      }

      const applications = await queryBuilder.getMany();

      // Calculate statistics
      const stats: IJobApplicationStats = {
        total_applications: applications.length,
        applications_by_status: this.calculateStatusStats(applications),
        average_ats_score: this.calculateAverageAtsScore(applications),
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
    if (payload.user_id) {
      const user = await this.userRepository.findOne({
        where: { id: payload.user_id },
      });
      if (!user) {
        throw new NotFoundException(
          'User not found',
          ERROR_CODES.USER_NOT_FOUND,
        );
      }
    }

    // Validate ATS match history exists if provided
    if (payload.ats_match_history_id) {
      const atsHistory = await this.atsMatchHistoryRepository.findOne({
        where: { id: payload.ats_match_history_id },
      });
      if (!atsHistory) {
        throw new NotFoundException(
          'ATS match history not found',
          ERROR_CODES.NOT_FOUND,
        );
      }
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
        'jobApplication.ats_match_history',
        'ats_match_history',
      )
      .leftJoinAndSelect(
        'jobApplication.resume_generation',
        'resume_generation',
      );

    // Add user/guest context filter
    if (query.user_id) {
      queryBuilder.where('jobApplication.user_id = :userId', {
        userId: query.user_id,
      });
    } else if (query.guest_id) {
      queryBuilder.where('jobApplication.guest_id = :guestId', {
        guestId: query.guest_id,
      });
    }

    // Add filters
    if (query.status) {
      queryBuilder.andWhere('jobApplication.status = :status', {
        status: query.status,
      });
    }

    if (query.company_name) {
      queryBuilder.andWhere('jobApplication.company_name ILIKE :companyName', {
        companyName: `%${query.company_name}%`,
      });
    }

    // Add sorting
    const sortBy = query.sort_by || 'created_at';
    const sortOrder = query.sort_order || 'DESC';
    queryBuilder.orderBy(`jobApplication.${sortBy}`, sortOrder);

    return queryBuilder;
  }

  /**
   * Generate suggestions based on ATS analysis
   */
  private generateSuggestions(atsAnalysis: any): string[] {
    const suggestions: string[] = [];

    if (atsAnalysis?.missingKeywords?.length > 0) {
      suggestions.push(
        `Consider adding these missing keywords: ${atsAnalysis.missingKeywords.slice(0, 5).join(', ')}`,
      );
    }

    if (atsAnalysis?.skillMatchScore < 70) {
      suggestions.push(
        'Your skill match score is low. Consider highlighting more relevant technical skills.',
      );
    }

    if (atsAnalysis?.sectionScores?.contactInfo < 80) {
      suggestions.push(
        'Ensure your contact information is complete and professional.',
      );
    }

    if (atsAnalysis?.sectionScores?.structure < 70) {
      suggestions.push(
        'Consider improving your resume structure and formatting.',
      );
    }

    return suggestions;
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

  private calculateAverageAtsScore(applications: JobApplication[]): number {
    const applicationsWithScore = applications.filter(
      (app) => app.ats_score !== null && app.ats_score !== undefined,
    );

    if (applicationsWithScore.length === 0) return 0;

    const total = applicationsWithScore.reduce(
      (sum, app) => sum + (app.ats_score || 0),
      0,
    );
    return Math.round((total / applicationsWithScore.length) * 100) / 100;
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
