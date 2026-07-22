import { CampaignCommentMode } from 'src/campaigns/entities/campaign.entity';
import {
  calculatePlatformFeeMsats,
  calculateRequiredImpactBalanceMsats,
  calculateRoutingReserveMsats,
  satsToMsats,
} from './fees.util';

describe('fees util in msats', () => {
  it('calcula el fee fijo e IA en msats', () => {
    expect(calculatePlatformFeeMsats(100, CampaignCommentMode.FIXED)).toBe(
      2000n,
    );
    expect(calculatePlatformFeeMsats(100, CampaignCommentMode.AI)).toBe(5000n);
  });

  it('aplica 0.3% con reserva mínima de un sat por pago', () => {
    expect(calculateRoutingReserveMsats(100_000n)).toBe(1000n);
    expect(calculateRoutingReserveMsats(1_000_000n)).toBe(3000n);
  });

  it('exige Zap, fee y las dos reservas', () => {
    expect(calculateRequiredImpactBalanceMsats(100_000n, 2000n)).toBe(104_000n);
  });

  it('convierte sats enteros una sola vez', () => {
    expect(satsToMsats(125)).toBe(125_000n);
    expect(() => satsToMsats(1.25)).toThrow();
  });
});
