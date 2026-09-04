import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  QueueJobData,
  QueueService,
} from '../../queue/queue.service';

import { JobRepository } from '../../database/repositories/job.repository';
import { JOB_TIMEOUT } from '../../shared/constants';
import { SemanticCacheService } from '../../llm/semantic-cache.service';

@Injectable()
export class JobProcessor {
  private readonly logger = new Logger(JobProcessor.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueService: QueueService,
    private readonly semanticCacheService: SemanticCacheService,
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
      const result = await this.executeWithTimeout(
        jobId,
        (async (): Promise<Record<string, any> | undefined> => {
          switch (type) {
            case 'email':
              await this.processEmailJob(payload);
              return undefined;

            case 'llm-inference':
              return await this.processLlmInferenceJob(payload);

            // case 'fail':
            //   // Temporary failure type used to test retry/DLQ behavior.
            //   throw new Error(
            //     'Intentional failure for retry testing',
            //   );

            // case 'slow':
            //   // Temporary slow job used to test timeout behavior.
            //   await new Promise((resolve) =>
            //     setTimeout(resolve, 10_000),
            //   );
            //   break;

            default:
              await this.processDefaultJob(payload);
              return undefined;
          }
        })(),
      );

      await this.jobRepository.markAsCompleted(jobId, result);

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

  private async executeWithTimeout<T>(
    jobId: string,
    work: Promise<T>,
  ): Promise<T> {
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
      return await Promise.race([work, timeout]);
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

  private async processLlmInferenceJob(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const prompt = payload.prompt;

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error(
        'llm-inference job payload must include a non-empty "prompt" string',
      );
    }

    this.logger.log(
      `Processing llm-inference job (prompt length: ${prompt.length})`,
    );

    const { response, cacheHit, similarity } =
      await this.semanticCacheService.getCompletion(prompt);

    return { response, cacheHit, similarity };
  }

  private async processDefaultJob(
  payload: Record<string, any>,
): Promise<void> {
  if (payload.fail === true) {
    throw new Error('Intentional failure for testing');
  }

  this.logger.log(
    `Processing job: ${JSON.stringify(payload)}`,
  );

  await new Promise((resolve) =>
    setTimeout(resolve, 500),
  );
}
}