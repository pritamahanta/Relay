import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { JobsService } from './jobs.service';
import { JobRepository } from '../database/repositories/job.repository';
import { QueueService } from '../queue/queue.service';


function uniqueViolationError(): QueryFailedError {
  const error = new QueryFailedError('INSERT ...', [], new Error('unique'));

  (error as unknown as { code: string }).code = '23505';

  return error;
}

describe('JobsService', () => {
  let service: JobsService;

  const jobRepository = {
    createJob: jest.fn(),
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    markAsFailed: jest.fn(),
  };

  const queueService = {
    addJob: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          JobsService,
          {
            provide: JobRepository,
            useValue: jobRepository,
          },
          {
            provide: QueueService,
            useValue: queueService,
          },
        ],
      }).compile();

    service = module.get<JobsService>(JobsService);
  });

  it('should create and enqueue a job', async () => {
    const job = {
      id: 'job-1',
      type: 'email',
      payload: {
        to: 'test@example.com',
      },
      priority: 5,
      maxAttempts: 10,
      delay: undefined,
      status: 'QUEUED',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
      completedAt: null,
      error: null,
    };

    jobRepository.findByIdempotencyKey.mockResolvedValue(null);
    jobRepository.createJob.mockResolvedValue(job);
    queueService.addJob.mockResolvedValue(undefined);

    const result = await service.createJob({
      type: 'email',
      payload: {
        to: 'test@example.com',
      },
    });

    expect(jobRepository.createJob).toHaveBeenCalled();
    expect(queueService.addJob).toHaveBeenCalledWith(
      job.id,
      job.type,
      job.payload,
      {
        priority: job.priority,
        delay: job.delay,
        maxAttempts: job.maxAttempts,
      },
    );

    expect(result.id).toBe(job.id);
    expect(result.status).toBe(job.status);
  });

  it('should return the existing job for the same idempotency key', async () => {
    const existingJob = {
      id: 'existing-job',
      type: 'email',
      payload: {
        to: 'test@example.com',
      },
      priority: 5,
      maxAttempts: 10,
      delay: undefined,
      status: 'QUEUED',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
      completedAt: null,
      error: null,
    };

    jobRepository.findByIdempotencyKey.mockResolvedValue(
      existingJob,
    );

    const result = await service.createJob({
      type: 'email',
      payload: {
        to: 'test@example.com',
      },
      idempotencyKey: 'same-key',
    });

    expect(
      jobRepository.findByIdempotencyKey,
    ).toHaveBeenCalledWith('same-key');

    expect(jobRepository.createJob).not.toHaveBeenCalled();
    expect(queueService.addJob).not.toHaveBeenCalled();

    expect(result.id).toBe(existingJob.id);
  });

  it('should return the winning job when it loses the idempotent insert race', async () => {
 
    const winner = {
      id: 'winner-job',
      type: 'email',
      payload: { to: 'test@example.com' },
      priority: 5,
      maxAttempts: 10,
      delay: undefined,
      status: 'QUEUED',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
      completedAt: null,
      error: null,
    };

    jobRepository.findByIdempotencyKey
      .mockResolvedValueOnce(null) 
      .mockResolvedValueOnce(winner); 

    jobRepository.createJob.mockRejectedValue(uniqueViolationError());

    const result = await service.createJob({
      type: 'email',
      payload: { to: 'test@example.com' },
      idempotencyKey: 'same-key',
    });

    expect(jobRepository.findByIdempotencyKey).toHaveBeenCalledTimes(2);
    expect(queueService.addJob).not.toHaveBeenCalled();
    expect(result.id).toBe(winner.id);
  });

  it('should mark the job failed and rethrow when enqueueing fails after it was persisted', async () => {
    const job = {
      id: 'job-1',
      type: 'email',
      payload: { to: 'test@example.com' },
      priority: 5,
      maxAttempts: 10,
      delay: undefined,
      status: 'QUEUED',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
      completedAt: null,
      error: null,
    };

    jobRepository.findByIdempotencyKey.mockResolvedValue(null);
    jobRepository.createJob.mockResolvedValue(job);

    const redisDown = new Error('Redis connection refused');
    queueService.addJob.mockRejectedValue(redisDown);

    await expect(
      service.createJob({
        type: 'email',
        payload: { to: 'test@example.com' },
      }),
    ).rejects.toThrow('Redis connection refused');

  
    expect(jobRepository.markAsFailed).toHaveBeenCalledWith(
      job.id,
      expect.stringContaining('Redis connection refused'),
    );
  });

  it('should throw when a job does not exist', async () => {
    jobRepository.findById.mockResolvedValue(null);

    await expect(
      service.getJobStatus('missing-job'),
    ).rejects.toThrow(NotFoundException);
  });
});