import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  IsPositive,
} from 'class-validator';

import { JobPriority } from '../../shared/enums/job-priority.enum';

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsObject()
  payload: Record<string, any>;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  idempotencyKey?: string;

  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  delay?: number;
}