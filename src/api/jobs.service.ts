import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { JobEntity } from '../database/entities/job.entity';
import { JobRepository } from '../database/repositories/job.repository';
import { QueueService } from '../queue/queue.service';

import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';

// Postgres error code for a unique_violation (e.g. our unique index on
// idempotencyKey). See https://www.postgresql.org/docs/current/errcodes-appendix.html
const POSTGRES_UNIQUE_VIOLATION = '23505';

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

    let job: JobEntity;

    try {
      job = await this.jobRepository.createJob(dto);
    } catch (error) {
      if (
        dto.idempotencyKey &&
        this.isUniqueViolation(error)
      ) {
        const winner =
          await this.jobRepository.findByIdempotencyKey(
            dto.idempotencyKey,
          );

        if (winner) {
          this.logger.log(
            `Lost idempotency insert race, returning existing job: ${dto.idempotencyKey}`,
          );

          return this.mapToResponse(winner);
        }
      }

      throw error;
    }

    try {
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
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error';

      this.logger.error(
        `Failed to enqueue job ${job.id}: ${errorMessage}`,
      );

      await this.jobRepository.markAsFailed(
        job.id,
        `Failed to enqueue: ${errorMessage}`,
      );

      throw error;
    }

    this.logger.log(
      `Job ${job.id} created and queued`,
    );

    return this.mapToResponse(job);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as unknown as { code?: string }).code ===
        POSTGRES_UNIQUE_VIOLATION
    );
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
    job: JobEntity,
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