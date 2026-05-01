import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { JobApplicationInterviewService } from '../services/job-application-interview.service';
import {
  CreateJobApplicationInterviewDto,
  UpdateJobApplicationInterviewDto,
} from '../dtos/job-application-interview.dto';

@ApiTags('Job Applications')
@Controller('job-applications/:id/interviews')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class JobApplicationInterviewController {
  constructor(
    private readonly interviewService: JobApplicationInterviewService,
  ) {}

  @Get()
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: RequestWithUserContext,
  ) {
    return this.interviewService.listInterviews(
      id,
      request.userContext?.userId,
    );
  }

  @Post()
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobApplicationInterviewDto,
    @Req() request: RequestWithUserContext,
  ) {
    return this.interviewService.createInterview(
      id,
      request.userContext?.userId,
      dto,
    );
  }

  @Put(':interviewId')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Body() dto: UpdateJobApplicationInterviewDto,
    @Req() request: RequestWithUserContext,
  ) {
    return this.interviewService.updateInterview(
      id,
      interviewId,
      request.userContext?.userId,
      dto,
    );
  }

  @Delete(':interviewId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<void> {
    await this.interviewService.deleteInterview(
      id,
      interviewId,
      request.userContext?.userId,
    );
  }
}
