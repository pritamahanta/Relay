import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  QueueJobData,
  QueueService,
} from '../../queue/queue.service';

import { JobRepository } from '../../database/repositories/job.repository';
import { JOB_TIMEOUT } from '../../shared/constants';

@Injectable()
export class JobProcessor {
  private readonly logger = new Logger(JobProcessor.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueService: QueueService,
  ) {}

  async process(job: Job<QueueJobData>): Promise<void> {
    const {
      jobId,
      type,
      payload,
      attempts,
      maxAttempts,
    } = job.data;

    const executionAttempt = attempts + 1;

    // Persist that this execution attempt has started.
    await this.jobRepository.incrementAttempts(jobId);

    this.logger.log(
      `Processing job ${jobId} ` +
        `(type: ${type}, ` +
        `attempt: ${executionAttempt}/${maxAttempts})`,
    );

    await this.jobRepository.markAsProcessing(jobId);

    try {
      await this.executeWithTimeout(
        jobId,
        (async () => {
          switch (type) {
            case 'email':
              await this.processEmailJob(payload);
              break;

            case 'fail':
              // Temporary failure type used to test retry/DLQ behavior.
              throw new Error(
                'Intentional failure for retry testing',
              );

            // case 'slow':
            //   // Temporary slow job used to test timeout behavior.
            //   await new Promise((resolve) =>
            //     setTimeout(resolve, 10_000),
            //   );
            //   break;

            default:
              await this.processDefaultJob(payload);
          }
        })(),
      );

      await this.jobRepository.markAsCompleted(jobId);

      this.logger.log(
        `Job ${jobId} completed successfully`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error';

      this.logger.error(
        `Job ${jobId} failed on attempt ` +
          `${executionAttempt}: ${errorMessage}`,
      );

      await this.jobRepository.markAsFailed(
        jobId,
        errorMessage,
      );

      if (executionAttempt < maxAttempts) {
        await this.queueService.retryJob(job);

        this.logger.log(
          `Job ${jobId} scheduled for retry ` +
            `${executionAttempt}`,
        );
      } else {
        await this.queueService.moveToDLQ(
          job,
          errorMessage,
        );

        this.logger.warn(
          `Job ${jobId} moved to DLQ after ` +
            `${executionAttempt} attempts`,
        );
      }

      // Tell BullMQ that the current queue execution failed.
      throw error;
    }
  }

  private async executeWithTimeout(
    jobId: string,
    work: Promise<void>,
  ): Promise<void> {
    let timeoutId: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Job ${jobId} timed out after ${JOB_TIMEOUT}ms`,
          ),
        );
      }, JOB_TIMEOUT);
    });

    try {
      await Promise.race([work, timeout]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async processEmailJob(
    payload: Record<string, any>,
  ): Promise<void> {
    this.logger.log(
      `Processing email for ${payload.to}`,
    );

    // Simulate email processing.
    await new Promise((resolve) =>
      setTimeout(resolve, 1000),
    );
  }

  private async processDefaultJob(
    payload: Record<string, any>,
  ): Promise<void> {
    this.logger.log(
      `Processing job: ${JSON.stringify(payload)}`,
    );

    // Simulate generic background work.
    await new Promise((resolve) =>
      setTimeout(resolve, 500),
    );
  }
}