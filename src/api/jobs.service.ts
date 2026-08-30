import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { JobRepository } from '../database/repositories/job.repository';
import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly jobRepository: JobRepository,
  ) {}

  async createJob(dto: CreateJobDto): Promise<JobResponseDto> {
    const job = await this.jobRepository.createJob(dto);

    this.logger.log(`Job ${job.id} created`);

    return this.mapToResponse(job);
  }

  async getJobStatus(jobId: string): Promise<JobResponseDto> {
    const job = await this.jobRepository.findById(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    return this.mapToResponse(job);
  }

  private mapToResponse(job: any): JobResponseDto {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      priority: job.priority,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      processedAt: job.processedAt,
      completedAt: job.completedAt,
      error: job.error,
    };
  }
}