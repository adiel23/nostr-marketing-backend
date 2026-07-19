import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductDescriptionToCampaigns1784309366462 implements MigrationInterface {
  name = 'AddProductDescriptionToCampaigns1784309366462';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD "productDescription" text NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP COLUMN "productDescription"`,
    );
  }
}
