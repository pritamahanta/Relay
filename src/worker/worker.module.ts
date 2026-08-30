import { Module } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module';
import { DatabaseModule } from '../database/database.module';

import { WorkerService } from './worker.service';
import { JobProcessor } from './processors/job.processor';

@Module({
  imports: [QueueModule, DatabaseModule],
  providers: [WorkerService, JobProcessor],
})
export class WorkerModule {}