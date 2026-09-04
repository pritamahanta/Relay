import { DataSource } from 'typeorm';

import { LlmCacheRepository } from './llm-cache.repository';

describe('LlmCacheRepository', () => {
  let repository: LlmCacheRepository;

  const dataSource = {
    query: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    repository = new LlmCacheRepository(
      dataSource as unknown as DataSource,
    );
  });

  describe('findSimilar', () => {
    it('returns null on a cache miss (no row above threshold)', async () => {
      dataSource.query.mockResolvedValue([]);

      const result = await repository.findSimilar([0.1, 0.2], 0.92);

      expect(result).toBeNull();
    });

    it('returns the closest match with parsed similarity on a hit', async () => {
      dataSource.query.mockResolvedValue([
        {
          id: 'entry-1',
          prompt: 'earlier prompt',
          response: 'earlier response',
          similarity: '0.9532',
        },
      ]);

      const result = await repository.findSimilar([0.1, 0.2], 0.92);

      expect(result).toEqual({
        id: 'entry-1',
        prompt: 'earlier prompt',
        response: 'earlier response',
        similarity: 0.9532,
      });

      // Vector gets serialized as a pgvector literal string, and the
      // threshold is passed through untouched as $2.
      const [, params] = dataSource.query.mock.calls[0];
      expect(params).toEqual(['[0.1,0.2]', 0.92]);
    });
  });

  describe('save', () => {
    it('inserts with a UUID, serialized vector, and TTL interval', async () => {
      dataSource.query.mockResolvedValue(undefined);

      await repository.save('a prompt', [0.1, 0.2], 'a response', 60_000);

      const [sql, params] = dataSource.query.mock.calls[0];

      expect(sql).toContain('INSERT INTO llm_cache_entries');
      expect(params[1]).toBe('a prompt');
      expect(params[2]).toBe('[0.1,0.2]');
      expect(params[3]).toBe('a response');
      expect(params[4]).toBe(60_000);
    });
  });
});
