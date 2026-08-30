import { JobProcessor } from './job.processor';
import { JobRepository } from '../../database/repositories/job.repository';
import { QueueService } from '../../queue/queue.service';

describe('JobProcessor', () => {
  let processor: JobProcessor;

  const jobRepository = {
    incrementAttempts: jest.fn(),
    markAsProcessing: jest.fn(),
    markAsCompleted: jest.fn(),
    markAsFailed: jest.fn(),
    markAsDeadLetter: jest.fn(),
  };

  const queueService = {
    retryJob: jest.fn(),
    moveToDLQ: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    processor = new JobProcessor(
      jobRepository as unknown as JobRepository,
      queueService as unknown as QueueService,
    );
  });

  it('should complete a successful job', async () => {
    const job = {
      data: {
        jobId: 'job-1',
        type: 'email',
        payload: {
          to: 'test@example.com',
        },
        attempts: 0,
        maxAttempts: 3,
      },
    } as any;

    await processor.process(job);

    expect(
      jobRepository.incrementAttempts,
    ).toHaveBeenCalledWith('job-1');

    expect(
      jobRepository.markAsProcessing,
    ).toHaveBeenCalledWith('job-1');

    expect(
      jobRepository.markAsCompleted,
    ).toHaveBeenCalledWith('job-1');

    expect(
      queueService.retryJob,
    ).not.toHaveBeenCalled();

    expect(
      queueService.moveToDLQ,
    ).not.toHaveBeenCalled();
  });

  it('should retry a failed job when attempts remain', async () => {
    const job = {
      data: {
        jobId: 'job-2',
        type: 'test',
        payload: {
          fail: true,
        },
        attempts: 0,
        maxAttempts: 3,
      },
    } as any;

    queueService.retryJob.mockResolvedValue(undefined);

    await expect(
      processor.process(job),
    ).rejects.toThrow(
      'Intentional failure for testing',
    );

    expect(
      jobRepository.incrementAttempts,
    ).toHaveBeenCalledWith('job-2');

    expect(
      jobRepository.markAsProcessing,
    ).toHaveBeenCalledWith('job-2');

    expect(
      jobRepository.markAsFailed,
    ).toHaveBeenCalledWith(
      'job-2',
      'Intentional failure for testing',
    );

    expect(
      queueService.retryJob,
    ).toHaveBeenCalledWith(job);

    expect(
      queueService.moveToDLQ,
    ).not.toHaveBeenCalled();
  });

  it('should move a failed job to DLQ when max attempts are reached', async () => {
    const job = {
      data: {
        jobId: 'job-3',
        type: 'test',
        payload: {
          fail: true,
        },
        attempts: 2,
        maxAttempts: 3,
      },
    } as any;

    queueService.moveToDLQ.mockResolvedValue(undefined);

    await expect(
      processor.process(job),
    ).rejects.toThrow(
      'Intentional failure for testing',
    );

    expect(
      jobRepository.incrementAttempts,
    ).toHaveBeenCalledWith('job-3');

    expect(
      jobRepository.markAsProcessing,
    ).toHaveBeenCalledWith('job-3');

    expect(
      jobRepository.markAsFailed,
    ).toHaveBeenCalledWith(
      'job-3',
      'Intentional failure for testing',
    );

    expect(
      queueService.retryJob,
    ).not.toHaveBeenCalled();

    expect(
      queueService.moveToDLQ,
    ).toHaveBeenCalledWith(
      job,
      'Intentional failure for testing',
    );
  });
});