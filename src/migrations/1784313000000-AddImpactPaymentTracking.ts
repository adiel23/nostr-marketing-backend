import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImpactPaymentTracking1784313000000 implements MigrationInterface {
  name = 'AddImpactPaymentTracking1784313000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD COLUMN IF NOT EXISTS "bolt11" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD COLUMN IF NOT EXISTS "payment_hash" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD COLUMN IF NOT EXISTS "preimage" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD COLUMN IF NOT EXISTS "payment_attempted_at" timestamp`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD COLUMN IF NOT EXISTS "comment_event_id" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN IF EXISTS "comment_event_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN IF EXISTS "payment_attempted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN IF EXISTS "preimage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN IF EXISTS "payment_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN IF EXISTS "bolt11"`,
    );
  }
}
