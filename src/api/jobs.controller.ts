import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';

import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(
    @Body() dto: CreateJobDto,
  ): Promise<JobResponseDto> {
    return this.jobsService.createJob(dto);
  }

  @Get(':id')
  async getJobStatus(
    @Param('id') id: string,
  ): Promise<JobResponseDto> {
    return this.jobsService.getJobStatus(id);
  }
}