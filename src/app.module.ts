import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { JobsController } from './api/jobs.controller';
import { JobsService } from './api/jobs.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    QueueModule,
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class AppModule {}