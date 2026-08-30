import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { JobEntity } from '../entities/job.entity';
import { JobStatus } from '../../shared/enums/job-status.enum';
import { JobPriority } from '../../shared/enums/job-priority.enum';

@Injectable()
export class JobRepository {
  constructor(
    @InjectRepository(JobEntity)
    private readonly repository: Repository<JobEntity>,
  ) {}

  async createJob(data: {
    type: string;
    payload: Record<string, any>;
    idempotencyKey?: string;
    priority?: JobPriority;
    maxAttempts?: number;
    delay?: number;
  }): Promise<JobEntity> {
    const job = this.repository.create({
      id: randomUUID(),
      type: data.type,
      payload: data.payload,
      idempotencyKey: data.idempotencyKey,
      priority: data.priority ?? JobPriority.NORMAL,
      maxAttempts: data.maxAttempts ?? 10,
      delay: data.delay,
      status: JobStatus.QUEUED,
      attempts: 0,
    });

    return this.repository.save(job);
  }

  async findByIdempotencyKey(
    key: string,
  ): Promise<JobEntity | null> {
    return this.repository.findOne({
      where: { idempotencyKey: key },
    });
  }

  async findById(id: string): Promise<JobEntity | null> {
    return this.repository.findOne({
      where: { id },
    });
  }

  async updateStatus(
    id: string,
    status: JobStatus,
    options?: {
      error?: string;
      processedAt?: Date;
      completedAt?: Date;
    },
  ): Promise<void> {
    await this.repository.update(id, {
      status,
      ...options,
    });
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.repository.increment(
      { id },
      'attempts',
      1,
    );
  }

  async markAsProcessing(id: string): Promise<void> {
    await this.repository.update(id, {
      status: JobStatus.PROCESSING,
      processedAt: new Date(),
    });
  }

  async markAsCompleted(id: string): Promise<void> {
    await this.repository.update(id, {
      status: JobStatus.COMPLETED,
      completedAt: new Date(),
    });
  }

  async markAsFailed(
    id: string,
    error: string,
  ): Promise<void> {
    await this.repository.update(id, {
      status: JobStatus.FAILED,
      error,
    });
  }

  async markAsDeadLetter(
    id: string,
    error: string,
  ): Promise<void> {
    await this.repository.update(id, {
      status: JobStatus.DEAD_LETTER,
      error,
    });
  }
}