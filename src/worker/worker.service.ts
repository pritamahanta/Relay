import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { Job, Worker } from 'bullmq';

import {
  QueueJobData,
  QueueService,
} from '../queue/queue.service';
import { JobRepository } from '../database/repositories/job.repository';
import { JobStatus } from '../shared/enums/job-status.enum';

import { JobProcessor } from './processors/job.processor';

@Injectable()
export class WorkerService
  implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);

  private worker!: Worker<QueueJobData>;

  constructor(
    private readonly queueService: QueueService,
    private readonly jobProcessor: JobProcessor,
    private readonly jobRepository: JobRepository,
  ) { }

  async onModuleInit(): Promise<void> {
    this.worker = this.queueService.createWorker(
      async (job) => {
        await this.jobProcessor.process(job);
      },
    );

    this.worker.on('ready', () => {
      this.logger.log('Worker ready to process jobs');
    });

    this.worker.on('error', (error) => {
      this.logger.error(`Worker error: ${error.message}`);
    });

    this.worker.on('failed', (job, error) => {
      if (!job) {
        return;
      }

      void this.handleUnrecoveredFailure(job, error);
    });
  }

  private async handleUnrecoveredFailure(
    job: Job<QueueJobData>,
    error: Error,
  ): Promise<void> {
    try {
      const dbJob = await this.jobRepository.findById(
        job.data.jobId,
      );

      if (!dbJob || dbJob.status !== JobStatus.PROCESSING) {
        return;
      }

      const errorMessage = `Reconciled stalled job: ${error.message}`;

      this.logger.warn(
        `Job ${job.data.jobId} was stuck in PROCESSING with no ` +
        `recorded failure (likely a worker crash/stall) — reconciling.`,
      );

      await this.jobRepository.markAsFailed(
        job.data.jobId,
        errorMessage,
      );

      const executionAttempt = job.data.attempts + 1;

      if (executionAttempt < job.data.maxAttempts) {
        await this.queueService.retryJob(job);
      } else {
        await this.queueService.moveToDLQ(job, errorMessage);
      }
    } catch (reconciliationError) {
      const message =
        reconciliationError instanceof Error
          ? reconciliationError.message
          : 'Unknown error';

      this.logger.error(
        `Failed to reconcile stalled job ${job.data.jobId}: ${message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}