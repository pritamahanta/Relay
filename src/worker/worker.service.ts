import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { Worker } from 'bullmq';

import {
  QueueJobData,
  QueueService,
} from '../queue/queue.service';

import { JobProcessor } from './processors/job.processor';

@Injectable()
export class WorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkerService.name);

  private worker!: Worker<QueueJobData>;

  constructor(
    private readonly queueService: QueueService,
    private readonly jobProcessor: JobProcessor,
  ) {}

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
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}