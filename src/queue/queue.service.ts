import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { JobRepository } from '../database/repositories/job.repository';

const MAIN_QUEUE = 'main-queue';
const DLQ = 'dead-letter-queue';

export interface QueueJobData {
  jobId: string;
  type: string;
  payload: Record<string, any>;
  attempts: number;
  maxAttempts: number;
}

@Injectable()
export class QueueService
  implements OnModuleInit, OnModuleDestroy
{
  private connection!: Redis;
  private mainQueue!: Queue<QueueJobData>;
  private dlQueue!: Queue<QueueJobData>;

  constructor(
    private readonly configService: ConfigService,
    private readonly jobRepository: JobRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisHost = this.configService.get(
      'REDIS_HOST',
      'localhost',
    );

    const redisPort = this.configService.get(
      'REDIS_PORT',
      6379,
    );

    this.connection = new Redis({
      host: redisHost,
      port: redisPort,
      maxRetriesPerRequest: null,
    });

    this.mainQueue = new Queue<QueueJobData>(
      MAIN_QUEUE,
      {
        connection: this.connection,
      },
    );

    this.dlQueue = new Queue<QueueJobData>(
      DLQ,
      {
        connection: this.connection,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.mainQueue.close();
    await this.dlQueue.close();
    await this.connection.quit();
  }

async addJob(
  jobId: string,
  type: string,
  payload: Record<string, any>,
  options: {
    priority?: number;
    delay?: number;
    maxAttempts?: number;
  } = {},
): Promise<void> {
  const jobData: QueueJobData = {
    jobId,
    type,
    payload,
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 10,
  };

  await this.mainQueue.add(type, jobData, {
    jobId,
    priority: options.priority,
    delay: options.delay,
  });
}

  private calculateBackoff(
    attemptNumber: number,
  ): number {
    return 1000 * Math.pow(2, attemptNumber);
  }

  async retryJob(
    job: Job<QueueJobData>,
  ): Promise<void> {
    const currentAttempt = job.data.attempts;
    const nextAttempt = currentAttempt + 1;

    const delay = this.calculateBackoff(
      currentAttempt,
    );

    await this.mainQueue.add(
      job.data.type,
      {
        ...job.data,
        attempts: nextAttempt,
      },
      {
        jobId: `${job.data.jobId}-retry-${currentAttempt}`,
        delay,
      },
    );
  }

  async moveToDLQ(
    job: Job<QueueJobData>,
    error: string,
  ): Promise<void> {
    await this.dlQueue.add(
      `dlq-${job.data.type}`,
      {
        ...job.data,
      },
    );

    await this.jobRepository.markAsDeadLetter(
      job.data.jobId,
      error,
    );
  }

  createWorker(
    processor: (
      job: Job<QueueJobData>,
    ) => Promise<void>,
  ): Worker<QueueJobData> {
    return new Worker<QueueJobData>(
      MAIN_QUEUE,
      processor,
      {
        connection: this.connection,
        concurrency: parseInt(
          this.configService.get(
            'WORKER_CONCURRENCY',
            '5',
          ),
          10,
        ),
      },
    );
  }
}