import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenImpactIdempotency1784311000000 implements MigrationInterface {
  name = 'HardenImpactIdempotency1784311000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."impacts_status_enum" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'full_success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP CONSTRAINT IF EXISTS "UQ_impacts_target_event_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_impacts_campaign_pubkey"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_impacts_campaign_event" ON "impacts" ("campaign_id", "target_event_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_impacts_campaign_pubkey" ON "impacts" ("campaign_id", "target_pubkey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_impacts_campaign_pubkey"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_impacts_campaign_event"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_impacts_campaign_pubkey" ON "impacts" ("campaign_id", "target_pubkey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD CONSTRAINT "UQ_impacts_target_event_id" UNIQUE ("target_event_id")`,
    );
  }
}
