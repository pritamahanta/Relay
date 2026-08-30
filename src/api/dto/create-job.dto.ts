import { JobPriority } from '../../shared/enums/job-priority.enum';

export class CreateJobDto {
  type: string;
  payload: Record<string, any>;
  idempotencyKey?: string;
  priority?: JobPriority;
  maxAttempts?: number;
  delay?: number;
}