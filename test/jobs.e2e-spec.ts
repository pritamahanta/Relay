import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../src/app.module';


describe('Jobs API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /jobs', () => {
    it('creates a job and returns it as QUEUED', async () => {
      const response = await request(app.getHttpServer())
        .post('/jobs')
        .send({
          type: 'email',
          payload: { to: 'e2e@example.com' },
        })
        .expect(201);

      expect(response.body).toMatchObject({
        type: 'email',
        status: 'QUEUED',
        attempts: 0,
      });
      expect(response.body.id).toBeDefined();
    });

    it('rejects a request missing the required "type" field', async () => {
      await request(app.getHttpServer())
        .post('/jobs')
        .send({ payload: { to: 'e2e@example.com' } })
        .expect(400);
    });

    it('rejects unrecognised fields on the request body', async () => {
      await request(app.getHttpServer())
        .post('/jobs')
        .send({
          type: 'email',
          payload: { to: 'e2e@example.com' },
          notAField: 'nope',
        })
        .expect(400);
    });

    it('is idempotent for sequential requests with the same key', async () => {
      const idempotencyKey = `e2e-${randomUUID()}`;
      const body = {
        type: 'email',
        payload: { to: 'a@example.com' },
        idempotencyKey,
      };

      const first = await request(app.getHttpServer())
        .post('/jobs')
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/jobs')
        .send(body)
        .expect(201);

      expect(second.body.id).toBe(first.body.id);

      const rows = await dataSource.query(
        'SELECT count(*)::int AS count FROM jobs WHERE "idempotencyKey" = $1',
        [idempotencyKey],
      );
      expect(rows[0].count).toBe(1);
    });

    it('is idempotent under real concurrent requests with the same key (proves the DB-level race fix)', async () => {
      const idempotencyKey = `e2e-race-${randomUUID()}`;
      const body = {
        type: 'email',
        payload: { to: 'race@example.com' },
        idempotencyKey,
      };


      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/jobs').send(body),
        request(app.getHttpServer()).post('/jobs').send(body),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).toBe(b.body.id);

      const rows = await dataSource.query(
        'SELECT count(*)::int AS count FROM jobs WHERE "idempotencyKey" = $1',
        [idempotencyKey],
      );
      expect(rows[0].count).toBe(1);
    });
  });

  describe('GET /jobs/:id', () => {
    it('returns a previously created job', async () => {
      const created = await request(app.getHttpServer())
        .post('/jobs')
        .send({ type: 'email', payload: { to: 'get@example.com' } })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/jobs/${created.body.id}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);
      expect(response.body.status).toBe('QUEUED');
    });

    it('returns 404 for a job that does not exist', async () => {
      await request(app.getHttpServer())
        .get(`/jobs/${randomUUID()}`)
        .expect(404);
    });
  });
});