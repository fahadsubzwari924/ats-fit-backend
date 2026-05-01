/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JobApplicationService } from './job-application.service';
import {
  CreateJobApplicationDto,
  UpdateJobApplicationDto,
  JobApplicationQueryDto,
} from './dtos/job-application.dto';
import {
  JobApplicationResponseDto,
  JobApplicationListResponseDto,
  JobApplicationStatsResponseDto,
} from './dtos/job-application-response.dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { SelectFields } from '../../shared/decorators/select-fields.decorator';

@ApiTags('Job Applications')
@Controller('job-applications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class JobApplicationController {
  private readonly logger = new Logger(JobApplicationController.name);

  constructor(private readonly jobApplicationService: JobApplicationService) {}

  @Post()
  async createJobApplication(
    @Body() dto: CreateJobApplicationDto,
    @Req() request: RequestWithUserContext,
  ): Promise<JobApplicationResponseDto> {
    this.logger.log('Creating job application for:', dto.company_name);

    const userContext = request?.userContext;
    const jobApplication =
      await this.jobApplicationService.createJobApplication({
        user_id: userContext?.userId,
        ...dto,
      });
    return this.mapToResponseDto(jobApplication);
  }

  @Get()
  @ApiOperation({
    summary: 'Get job applications',
    description:
      'List job applications with optional filters: `q` (company/position ILIKE), `status` or `statuses` (comma-separated; if `statuses` is set it takes precedence over `status`), date ranges (`applied_at_from`/`applied_at_to`, `deadline_from`/`deadline_to`, `follow_up_from`/`follow_up_to`), and `company_name`. Supports field selection via `fields` (e.g. ?fields=id,company_name,status).',
  })
  @ApiResponse({
    status: 200,
    description: 'Job applications retrieved successfully',
    type: JobApplicationListResponseDto,
  })
  async getJobApplications(
    @Query() query: JobApplicationQueryDto,
    @SelectFields() fields: string[],
    @Req() request: RequestWithUserContext,
  ): Promise<JobApplicationListResponseDto> {
    this.logger.log('Fetching job applications with query:', query);

    const userContext = request?.userContext;
    const { applications, total } =
      await this.jobApplicationService.getJobApplications({
        user_id: userContext?.userId,
        status: query.status,
        statuses: query.statuses,
        company_name: query.company_name,
        q: query.q,
        applied_at_from: query.applied_at_from,
        applied_at_to: query.applied_at_to,
        deadline_from: query.deadline_from,
        deadline_to: query.deadline_to,
        follow_up_from: query.follow_up_from,
        follow_up_to: query.follow_up_to,
        limit: query.limit || 20,
        offset: query.offset || 0,
        sort_by: query.sort_by || 'created_at',
        sort_order: query.sort_order || 'DESC',
        fields,
      });

    return {
      applications: applications.map((app) => this.mapToResponseDto(app)),
      total,
      count: applications.length,
      offset: query.offset || 0,
      limit: query.limit || 20,
    };
  }

  @Get('stats')
  async getJobApplicationStats(
    @SelectFields() fields: string[],
    @Req() request: RequestWithUserContext,
  ): Promise<JobApplicationStatsResponseDto> {
    this.logger.log('Generating job application statistics');

    const userContext = request?.userContext;
    const stats = await this.jobApplicationService.getJobApplicationStats({
      userId: userContext?.userId,
    });

    // Field selection could be applied to stats as well if needed
    // For now, we return the full stats object
    return stats;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get job application by ID',
    description:
      'Get detailed job application information by ID with optional field selection. Use the "fields" query parameter to specify which fields to return.',
  })
  @ApiParam({
    name: 'id',
    description: 'Job application ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Job application retrieved successfully',
    type: JobApplicationResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Job application not found',
  })
  async getJobApplicationById(
    @Param('id', ParseUUIDPipe) id: string,
    @SelectFields() fields: string[],
    @Req() request: RequestWithUserContext,
  ): Promise<JobApplicationResponseDto> {
    this.logger.log('Fetching job application by ID:', id);

    const userContext = request?.userContext;
    const application = await this.jobApplicationService.getJobApplicationById(
      id,
      {
        userId: userContext?.userId,
      },
      fields,
    );

    return this.mapToResponseDto(application);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update job application',
    description: 'Update job application status and details',
  })
  @ApiParam({
    name: 'id',
    description: 'Job application ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Job application updated successfully',
    type: JobApplicationResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Job application not found',
  })
  async updateJobApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobApplicationDto,
    @Req() request: RequestWithUserContext,
  ): Promise<JobApplicationResponseDto> {
    this.logger.log('Updating job application:', id);

    const userContext = request?.userContext;
    const application = await this.jobApplicationService.updateJobApplication(
      id,
      { ...dto },
      { userId: userContext?.userId },
    );
    return this.mapToResponseDto(application);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete job application',
    description: 'Delete a job application tracking record',
  })
  @ApiParam({
    name: 'id',
    description: 'Job application ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 204,
    description: 'Job application deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Job application not found',
  })
  async deleteJobApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: RequestWithUserContext,
  ): Promise<void> {
    this.logger.log('Deleting job application:', id);

    const userContext = request?.userContext;
    await this.jobApplicationService.deleteJobApplication(id, {
      userId: userContext?.userId,
    });
  }

  private mapToResponseDto(application: any): JobApplicationResponseDto {
    return {
      id: application.id,
      company_name: application.company_name,
      job_position: application.job_position,
      job_description: application.job_description,
      job_url: application.job_url,
      job_location: application.job_location,
      employment_type: application.employment_type,
      work_mode: application.work_mode,
      salary_min: application.salary_min,
      salary_max: application.salary_max,
      salary_currency: application.salary_currency,
      pay_period: application.pay_period,
      salary_negotiable: application.salary_negotiable,
      status: application.status,
      application_source: application.application_source,
      job_board_source: application.job_board_source,
      applied_via: application.applied_via,
      priority: application.priority,
      tags: application.tags,
      application_deadline: application.application_deadline,
      applied_at: application.applied_at,
      decision_deadline: application.decision_deadline,
      next_action: application.next_action,
      cover_letter: application.cover_letter,
      notes: application.notes,
      recruiter_name: application.recruiter_name,
      recruiter_email: application.recruiter_email,
      recruiter_phone: application.recruiter_phone,
      hiring_manager_name: application.hiring_manager_name,
      hiring_manager_email: application.hiring_manager_email,
      contact_phone: application.contact_phone,
      contacts: application.contacts,
      interview_scheduled_at: application.interview_scheduled_at,
      interview_notes: application.interview_notes,
      follow_up_date: application.follow_up_date,
      rejection_stage: application.rejection_stage,
      rejection_reason: application.rejection_reason,
      rejection_feedback_received: application.rejection_feedback_received,
      compensation_offer: application.compensation_offer,
      attachments: application.attachments,
      status_history: application.status_history,
      metadata: application.metadata,
      created_at: application.created_at,
      updated_at: application.updated_at,
      user_id: application.user_id,
    };
  }
}
