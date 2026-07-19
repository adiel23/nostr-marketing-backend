import { validate } from 'class-validator';
import { CreateCampaignDto } from './create-campaign.dto';

function createValidDto(): CreateCampaignDto {
  return Object.assign(new CreateCampaignDto(), {
    name: 'Campaign',
    productDescription: 'Description',
    keywords: ['wallet'],
    nwcUrl: 'nostr+walletconnect://example',
    satsPerImpact: 1,
    endsAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

describe('CreateCampaignDto', () => {
  it('rejects campaigns with no keywords or a zero sat impact', async () => {
    const dto = createValidDto();
    dto.keywords = [];
    dto.satsPerImpact = 0;

    const errors = await validate(dto);

    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['keywords', 'satsPerImpact']),
    );
  });

  it('rejects empty or blank keywords inside an otherwise non-empty list', async () => {
    const dto = createValidDto();
    dto.keywords = [''];

    const emptyErrors = await validate(dto);
    dto.keywords = ['   '];
    const blankErrors = await validate(dto);

    expect(emptyErrors.map(({ property }) => property)).toContain('keywords');
    expect(blankErrors.map(({ property }) => property)).toContain('keywords');
  });
});
