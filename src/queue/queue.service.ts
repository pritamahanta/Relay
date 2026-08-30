import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

interface QueueJobData {
  jobId: string;
  type: string;
  payload: Record<string, any>;
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private connection!: Redis;
  private mainQueue!: Queue<QueueJobData>;

  constructor(
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisHost = this.configService.get('REDIS_HOST', 'localhost');
    const redisPort = this.configService.get('REDIS_PORT', 6379);

    this.connection = new Redis({
      host: redisHost,
      port: redisPort,
      maxRetriesPerRequest: null,
    });

    this.mainQueue = new Queue<QueueJobData>('main-queue', {
      connection: this.connection,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.mainQueue.close();
    await this.connection.quit();
  }

  async addJob(
    jobId: string,
    type: string,
    payload: Record<string, any>,
  ): Promise<void> {
    await this.mainQueue.add(type, {
      jobId,
      type,
      payload,
    }, {
      jobId,
    });
  }
}