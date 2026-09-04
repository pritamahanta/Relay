import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1788506156833 implements MigrationInterface {
    name = 'InitialSchema1788506156833'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."jobs_status_enum" AS ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')`);
        await queryRunner.query(`CREATE TABLE "jobs" ("id" uuid NOT NULL, "idempotencyKey" character varying(255), "type" character varying(100) NOT NULL, "payload" jsonb NOT NULL, "priority" integer NOT NULL DEFAULT '10', "status" "public"."jobs_status_enum" NOT NULL DEFAULT 'QUEUED', "attempts" integer NOT NULL DEFAULT '0', "maxAttempts" integer NOT NULL DEFAULT '10', "delay" integer, "error" text, "result" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "processedAt" TIMESTAMP, "completedAt" TIMESTAMP, CONSTRAINT "UQ_e7bffc12dbf947ffa4b453eb60c" UNIQUE ("idempotencyKey"), CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c74ab2fbee0e088713193e0a77" ON "jobs" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_14d95a4e993e07ece3f6565831" ON "jobs" ("status", "priority") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_14d95a4e993e07ece3f6565831"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c74ab2fbee0e088713193e0a77"`);
        await queryRunner.query(`DROP TABLE "jobs"`);
        await queryRunner.query(`DROP TYPE "public"."jobs_status_enum"`);
    }

}
