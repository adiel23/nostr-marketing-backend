import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPromotionalComments1784312000000 implements MigrationInterface {
  name = 'AddPromotionalComments1784312000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."campaigns_comment_mode_enum" AS ENUM('fixed', 'ai')`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD "promotional_comment" text`,
    );
    await queryRunner.query(
      `UPDATE "campaigns" SET "promotional_comment" = "name" || ': ' || "productDescription"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ALTER COLUMN "promotional_comment" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD "comment_mode" "public"."campaigns_comment_mode_enum" NOT NULL DEFAULT 'fixed'`,
    );
    await queryRunner.query(`ALTER TABLE "impacts" ADD "comment_content" text`);
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "comment_event_id" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN "comment_event_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN "comment_content"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN "comment_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN "promotional_comment"`,
    );
    await queryRunner.query(`DROP TYPE "public"."campaigns_comment_mode_enum"`);
  }
}
