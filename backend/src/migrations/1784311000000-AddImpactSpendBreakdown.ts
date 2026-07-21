import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImpactSpendBreakdown1784311000000 implements MigrationInterface {
  name = 'AddImpactSpendBreakdown1784311000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "target_content" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "found_keywords" text array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "zap_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "lightning_fee_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "total_spent_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `UPDATE "impacts" SET "total_spent_sats" = "sats_charged"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "total_spent_sats"`);
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "lightning_fee_sats"`);
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "zap_sats"`);
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "found_keywords"`);
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "target_content"`);
  }
}
