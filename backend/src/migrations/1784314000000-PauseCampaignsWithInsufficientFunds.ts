import { MigrationInterface, QueryRunner } from 'typeorm';

export class PauseCampaignsWithInsufficientFunds1784314000000 implements MigrationInterface {
  name = 'PauseCampaignsWithInsufficientFunds1784314000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "campaigns" AS campaign
      SET "status" = 'paused'
      WHERE campaign."status" = 'active'
        AND EXISTS (
          SELECT 1
          FROM "impacts" AS impact
          WHERE impact."campaign_id" = campaign."id"
            AND impact."status" = 'funds_insufficient'
        )
    `);
  }

  public async down(): Promise<void> {
    // Es una pausa deliberada; no se reactivan campañas automáticamente al revertir.
  }
}
