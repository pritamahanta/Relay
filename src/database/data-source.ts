import 'dotenv/config';
import { DataSource } from 'typeorm';
import { JobEntity } from './entities/job.entity';

// Used by the TypeORM CLI only (migration:generate / migration:run).
// The NestJS app itself connects via database.module.ts, which builds
// its options from ConfigService instead of reading process.env directly.
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'job_queue',
  entities: [JobEntity],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});