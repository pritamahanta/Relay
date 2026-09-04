import { JobProcessor } from './job.processor';
import { JobRepository } from '../../database/repositories/job.repository';
import { QueueService } from '../../queue/queue.service';
import { SemanticCacheService } from '../../llm/semantic-cache.service';

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

  const semanticCacheService = {
    getCompletion: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    processor = new JobProcessor(
      jobRepository as unknown as JobRepository,
      queueService as unknown as QueueService,
      semanticCacheService as unknown as SemanticCacheService,
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
    ).toHaveBeenCalledWith('job-1', undefined);

    expect(
      queueService.retryJob,
    ).not.toHaveBeenCalled();

    expect(
      queueService.moveToDLQ,
    ).not.toHaveBeenCalled();
  });

  it('should complete an llm-inference job and persist its result', async () => {
    const job = {
      data: {
        jobId: 'job-llm-1',
        type: 'llm-inference',
        payload: { prompt: 'what is a job queue?' },
        attempts: 0,
        maxAttempts: 3,
      },
    } as any;

    semanticCacheService.getCompletion.mockResolvedValue({
      response: 'a job queue is...',
      cacheHit: true,
      similarity: 0.98,
    });

    await processor.process(job);

    expect(semanticCacheService.getCompletion).toHaveBeenCalledWith(
      'what is a job queue?',
    );

    expect(jobRepository.markAsCompleted).toHaveBeenCalledWith(
      'job-llm-1',
      {
        response: 'a job queue is...',
        cacheHit: true,
        similarity: 0.98,
      },
    );
  });

  it('should fail an llm-inference job with a missing prompt without calling the cache service', async () => {
    const job = {
      data: {
        jobId: 'job-llm-2',
        type: 'llm-inference',
        payload: {},
        attempts: 0,
        maxAttempts: 3,
      },
    } as any;

    await expect(processor.process(job)).rejects.toThrow(
      'llm-inference job payload must include a non-empty "prompt" string',
    );

    expect(semanticCacheService.getCompletion).not.toHaveBeenCalled();

    expect(jobRepository.markAsFailed).toHaveBeenCalledWith(
      'job-llm-2',
      'llm-inference job payload must include a non-empty "prompt" string',
    );
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