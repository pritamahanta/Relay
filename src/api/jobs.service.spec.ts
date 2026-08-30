import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { JobsService } from './jobs.service';
import { JobRepository } from '../database/repositories/job.repository';
import { QueueService } from '../queue/queue.service';

describe('JobsService', () => {
  let service: JobsService;

  const jobRepository = {
    createJob: jest.fn(),
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn(),
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

  it('should throw when a job does not exist', async () => {
    jobRepository.findById.mockResolvedValue(null);

    await expect(
      service.getJobStatus('missing-job'),
    ).rejects.toThrow(NotFoundException);
  });
});