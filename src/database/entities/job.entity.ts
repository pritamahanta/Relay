import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index} from 'typeorm';
import { JobStatus } from '../../shared/enums/job-status.enum';
import { JobPriority } from '../../shared/enums/job-priority.enum';

@Entity('jobs')
@Index(['status', 'priority'])
@Index(['idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
export class JobEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  idempotencyKey?: string;

  @Column({ type: 'varchar', length: 100 })
  type: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({
    type: 'int',
    default: JobPriority.NORMAL,
  })
  priority: JobPriority;

  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.QUEUED,
  })
  status: JobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 10 })
  maxAttempts: number;

  @Column({ type: 'int', nullable: true })
  delay?: number;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;
}

