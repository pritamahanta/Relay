import { WorkerService } from './worker.service';
import { QueueService } from '../queue/queue.service';
import { JobProcessor } from './processors/job.processor';
import { JobRepository } from '../database/repositories/job.repository';
import { JobStatus } from '../shared/enums/job-status.enum';

describe('WorkerService', () => {
  let service: WorkerService;

  const jobRepository = {
    findById: jest.fn(),
    markAsFailed: jest.fn(),
  };

  const queueService = {
    retryJob: jest.fn(),
    moveToDLQ: jest.fn(),
  };

  const jobProcessor = {
    process: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new WorkerService(
      queueService as unknown as QueueService,
      jobProcessor as unknown as JobProcessor,
      jobRepository as unknown as JobRepository,
    );
  });


  describe('handleUnrecoveredFailure (stalled-job safety net)', () => {
    const job = {
      data: {
        jobId: 'job-stalled',
        type: 'email',
        payload: { to: 'a@example.com' },
        attempts: 1,
        maxAttempts: 3,
      },
    } as any;

    it('does nothing when JobProcessor already reconciled the failure normally', async () => {
    
      jobRepository.findById.mockResolvedValue({
        status: JobStatus.FAILED,
      });

      await (service as any).handleUnrecoveredFailure(
        job,
        new Error('Intentional failure for testing'),
      );

      expect(jobRepository.markAsFailed).not.toHaveBeenCalled();
      expect(queueService.retryJob).not.toHaveBeenCalled();
      expect(queueService.moveToDLQ).not.toHaveBeenCalled();
    });

    it('does nothing when the job no longer exists in the DB', async () => {
      jobRepository.findById.mockResolvedValue(null);

      await (service as any).handleUnrecoveredFailure(
        job,
        new Error('job stalled more than allowable limit'),
      );

      expect(jobRepository.markAsFailed).not.toHaveBeenCalled();
    });

    it('retries a stalled job that still has attempts remaining', async () => {
      
      jobRepository.findById.mockResolvedValue({
        status: JobStatus.PROCESSING,
      });

      await (service as any).handleUnrecoveredFailure(
        job,
        new Error('job stalled more than allowable limit'),
      );

      expect(jobRepository.markAsFailed).toHaveBeenCalledWith(
        'job-stalled',
        expect.stringContaining('Reconciled stalled job'),
      );
      expect(queueService.retryJob).toHaveBeenCalledWith(job);
      expect(queueService.moveToDLQ).not.toHaveBeenCalled();
    });

    it('moves a stalled job to the DLQ once attempts are exhausted', async () => {
      const exhaustedJob = {
        data: { ...job.data, attempts: 2, maxAttempts: 3 }, 
      } as any;

      jobRepository.findById.mockResolvedValue({
        status: JobStatus.PROCESSING,
      });

      await (service as any).handleUnrecoveredFailure(
        exhaustedJob,
        new Error('job stalled more than allowable limit'),
      );

      expect(jobRepository.markAsFailed).toHaveBeenCalledWith(
        'job-stalled',
        expect.stringContaining('Reconciled stalled job'),
      );
      expect(queueService.moveToDLQ).toHaveBeenCalledWith(
        exhaustedJob,
        expect.stringContaining('Reconciled stalled job'),
      );
      expect(queueService.retryJob).not.toHaveBeenCalled();
    });

    it('logs and swallows reconciliation errors instead of crashing the worker process', async () => {
      jobRepository.findById.mockRejectedValue(new Error('DB unreachable'));

      await expect(
        (service as any).handleUnrecoveredFailure(
          job,
          new Error('job stalled more than allowable limit'),
        ),
      ).resolves.toBeUndefined();
    });
  });
});