import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImpactPaymentLedger1784313000000 implements MigrationInterface {
  name = 'AddImpactPaymentLedger1784313000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."campaigns_status_enum" ADD VALUE IF NOT EXISTS 'billing_blocked'`,
    );
    for (const value of [
      'processing',
      'fee_pending',
      'funds_insufficient',
      'failed_before_comment',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "public"."impacts_status_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    await queryRunner.query(`ALTER TABLE "impacts" ADD "signed_comment" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "comment_status" character varying NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "platform_fee_status" character varying NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "zap_status" character varying NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );

    await queryRunner.query(`
      CREATE TABLE "impact_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "impact_id" uuid NOT NULL,
        "type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "amount_msats" bigint NOT NULL,
        "routing_fee_msats" bigint NOT NULL DEFAULT 0,
        "invoice" text,
        "payment_hash" character varying,
        "preimage" character varying,
        "attempts" integer NOT NULL DEFAULT 0,
        "failure_code" character varying,
        "failure_message" text,
        "paid_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_impact_payments_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_impact_payments_impact_type" UNIQUE ("impact_id", "type"),
        CONSTRAINT "FK_impact_payments_impact_id" FOREIGN KEY ("impact_id")
          REFERENCES "impacts"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      INSERT INTO "impact_payments"
        ("impact_id", "type", "status", "amount_msats", "routing_fee_msats", "paid_at")
      SELECT
        "id",
        'zap',
        CASE WHEN "zap_sats" > 0 THEN 'paid' ELSE 'skipped' END,
        "zap_sats"::bigint * 1000,
        "lightning_fee_sats"::bigint,
        CASE WHEN "zap_sats" > 0 THEN "created_at" ELSE NULL END
      FROM "impacts"
    `);
    await queryRunner.query(`
      INSERT INTO "impact_payments"
        ("impact_id", "type", "status", "amount_msats", "routing_fee_msats")
      SELECT
        "id",
        'platform_fee',
        'legacy_uncollected',
        "platform_fee"::bigint * 1000,
        0
      FROM "impacts"
    `);
    await queryRunner.query(`
      UPDATE "impacts"
      SET
        "comment_status" = 'published',
        "platform_fee_status" = 'legacy_uncollected',
        "zap_status" = CASE WHEN "zap_sats" > 0 THEN 'paid' ELSE 'skipped' END
    `);

    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "sats_charged"`);
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "zap_sats"`);
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN "lightning_fee_sats"`,
    );
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "platform_fee"`);
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN "total_spent_sats"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "sats_charged" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "zap_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "lightning_fee_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "platform_fee" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" ADD "total_spent_sats" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      UPDATE "impacts" i
      SET
        "zap_sats" = COALESCE((z."amount_msats" / 1000)::integer, 0),
        "lightning_fee_sats" = COALESCE(z."routing_fee_msats"::integer, 0),
        "platform_fee" = COALESCE((p."amount_msats" / 1000)::integer, 0),
        "sats_charged" = COALESCE((
          z."amount_msats" + z."routing_fee_msats" +
          CASE WHEN p."status" = 'paid' THEN p."amount_msats" + p."routing_fee_msats" ELSE 0 END
        ) / 1000, 0)::integer,
        "total_spent_sats" = COALESCE((
          z."amount_msats" + z."routing_fee_msats" +
          CASE WHEN p."status" = 'paid' THEN p."amount_msats" + p."routing_fee_msats" ELSE 0 END
        ) / 1000, 0)::integer
      FROM "impact_payments" z
      LEFT JOIN "impact_payments" p
        ON p."impact_id" = z."impact_id" AND p."type" = 'platform_fee'
      WHERE z."impact_id" = i."id" AND z."type" = 'zap'
    `);
    await queryRunner.query(`DROP TABLE "impact_payments"`);
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "updated_at"`);
    await queryRunner.query(`ALTER TABLE "impacts" DROP COLUMN "zap_status"`);
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN "platform_fee_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN "comment_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "impacts" DROP COLUMN "signed_comment"`,
    );
  }
}
