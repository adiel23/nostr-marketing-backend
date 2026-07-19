import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignBudget1784312000000 implements MigrationInterface {
  name = 'AddCampaignBudget1784312000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "budget_sats" integer`,
    );
    await queryRunner.query(
      `UPDATE "campaigns" SET "budget_sats" = "sats_per_impact" WHERE "budget_sats" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ALTER COLUMN "budget_sats" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "reserved_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "spent_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD COLUMN IF NOT EXISTS "reserved_sats" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN IF EXISTS "reserved_sats"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "spent_sats"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "reserved_sats"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "budget_sats"`,
    );
  }
}
