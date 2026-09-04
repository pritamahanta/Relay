import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { QueueModule } from '../queue/queue.module';
import { DatabaseModule } from '../database/database.module';
import { LlmModule } from '../llm/llm.module';

import { WorkerService } from './worker.service';
import { JobProcessor } from './processors/job.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    QueueModule,
    DatabaseModule,
    LlmModule,
  ],
  providers: [WorkerService, JobProcessor],
})
export class WorkerModule {}