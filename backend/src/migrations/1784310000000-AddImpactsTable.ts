import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImpactsTable1784310000000 implements MigrationInterface {
  name = 'AddImpactsTable1784310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."impacts_status_enum" AS ENUM('full_success', 'comment_only')`,
    );
    await queryRunner.query(`
      CREATE TABLE "impacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL,
        "target_pubkey" character varying NOT NULL,
        "target_event_id" character varying NOT NULL,
        "status" "public"."impacts_status_enum" NOT NULL,
        "sats_charged" integer NOT NULL,
        "platform_fee" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_impacts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_impacts_target_event_id" UNIQUE ("target_event_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_impacts_campaign_pubkey"
      ON "impacts" ("campaign_id", "target_pubkey")
    `);
    await queryRunner.query(`
      ALTER TABLE "impacts"
      ADD CONSTRAINT "FK_impacts_campaign_id"
      FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP CONSTRAINT "FK_impacts_campaign_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_impacts_campaign_pubkey"`);
    await queryRunner.query(`DROP TABLE "impacts"`);
    await queryRunner.query(`DROP TYPE "public"."impacts_status_enum"`);
  }
}
