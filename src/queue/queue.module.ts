import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '../database/database.module';
import { QueueService } from './queue.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}