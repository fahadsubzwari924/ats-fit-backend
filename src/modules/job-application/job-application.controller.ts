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
        guest_id: userContext?.guestId,
        company_name: dto.company_name,
        job_position: dto.job_position,
        job_description: dto.job_description,
        application_source: dto.application_source,
        ats_match_history_id: dto.ats_match_history_id,
        resume_generation_id: dto.resume_generation_id,
        ats_score: dto.ats_score,
        ats_analysis: dto.ats_analysis,
        resume_content: dto.resume_content,
        job_url: dto.job_url,
        job_location: dto.job_location,
        current_salary: dto.current_salary,
        expected_salary: dto.expected_salary,
        cover_letter: dto.cover_letter,
        notes: dto.notes,
        metadata: dto.metadata,
      });

    return this.mapToResponseDto(jobApplication);
  }

  @Get()
  @ApiOperation({
    summary: 'Get job applications',
    description:
      'Get a list of job applications with optional field selection. Use the "fields" query parameter to specify which fields to return (e.g., ?fields=id,company_name,status)',
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
        guest_id: userContext?.guestId,
        status: query.status,
        company_name: query.company_name,
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
      guestId: userContext?.guestId,
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
        guestId: userContext?.guestId,
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
      {
        status: dto.status,
        applied_at: dto.applied_at ? new Date(dto.applied_at) : undefined,
        cover_letter: dto.cover_letter,
        notes: dto.notes,
        interview_scheduled_at: dto.interview_scheduled_at
          ? new Date(dto.interview_scheduled_at)
          : undefined,
        interview_notes: dto.interview_notes,
        rejection_reason: dto.rejection_reason,
        metadata: dto.metadata,
      },
      {
        userId: userContext?.userId,
        guestId: userContext?.guestId,
      },
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
      guestId: userContext?.guestId,
    });
  }

  /**
   * Helper method to map entity to response DTO
   */
  private mapToResponseDto(application: any): JobApplicationResponseDto {
    return {
      id: application.id,
      company_name: application.company_name,
      job_position: application.job_position,
      job_description: application.job_description,
      job_url: application.job_url,
      job_location: application.job_location,
      current_salary: application.current_salary,
      expected_salary: application.expected_salary,
      status: application.status,
      application_source: application.application_source,
      application_deadline: application.application_deadline,
      applied_at: application.applied_at,
      ats_score: application.ats_score,
      ats_analysis: application.ats_analysis,
      cover_letter: application.cover_letter,
      notes: application.notes,
      contact_phone: application.contact_phone,
      interview_scheduled_at: application.interview_scheduled_at,
      interview_notes: application.interview_notes,
      follow_up_date: application.follow_up_date,
      rejection_reason: application.rejection_reason,
      metadata: application.metadata,
      created_at: application.created_at,
      updated_at: application.updated_at,
      user_id: application.user_id,
      guest_id: application.guest_id,
    };
  }
}
