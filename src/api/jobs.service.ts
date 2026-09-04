import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { JobRepository } from '../database/repositories/job.repository';
import { QueueService } from '../queue/queue.service';

import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueService: QueueService,
  ) {}

  async createJob(
    dto: CreateJobDto,
  ): Promise<JobResponseDto> {
    // Check whether this request was already processed.
    if (dto.idempotencyKey) {
      const existing =
        await this.jobRepository.findByIdempotencyKey(
          dto.idempotencyKey,
        );

      if (existing) {
        this.logger.log(
          `Idempotent request detected: ${dto.idempotencyKey}`,
        );

        return this.mapToResponse(existing);
      }
    }

    // Create the persistent job first.
    const job = await this.jobRepository.createJob(dto);

    try {
      // Then enqueue the job.
      await this.queueService.addJob(
        job.id,
        job.type,
        job.payload,
      {
        priority: job.priority,
        delay: job.delay,
        maxAttempts: job.maxAttempts,
      },  
    );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue job ${job.id}`,
      );

      throw error;
    }

    this.logger.log(
      `Job ${job.id} created and queued`,
    );

    return this.mapToResponse(job);
  }

  async getJobStatus(
    jobId: string,
  ): Promise<JobResponseDto> {
    const job =
      await this.jobRepository.findById(jobId);

    if (!job) {
      throw new NotFoundException(
        `Job ${jobId} not found`,
      );
    }

    return this.mapToResponse(job);
  }

  private mapToResponse(
    job: any,
  ): JobResponseDto {
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
      result: job.result,
    };
  }
}