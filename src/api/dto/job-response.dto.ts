import { JobStatus } from '../../shared/enums/job-status.enum';
import { JobPriority } from '../../shared/enums/job-priority.enum';

export class JobResponseDto {
  id: string;
  type: string;
  status: JobStatus;
  priority: JobPriority;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  error?: string;
}