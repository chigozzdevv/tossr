import { db } from '@/config/database';
import { MarketType } from '@/shared/types';
import { mapServerToPrismaMarketType } from '@/utils/market-type-mapper';
import { AuthenticationError, NotFoundError, ValidationError } from '@/shared/errors';
import { TossrProgramService } from '@/solana/tossr-program-service';
import { getAdminKeypair } from '@/config/admin-keypair';
import { getMarketConfig } from '@/utils/market-config';
import { PublicKey } from '@solana/web3.js';

const tossrProgram = new TossrProgramService();

export class MarketsService {
  async getAllMarkets() {
    return db.market.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            rounds: true,
            bets: true,
          },
        },
      },
    });
  }

  async getMarketById(marketId: string) {
    const market = await db.market.findUnique({
      where: { id: marketId },
      include: {
        rounds: {
          take: 10,
          orderBy: { roundNumber: 'desc' },
          include: {
            _count: {
              select: { bets: true },
            },
          },
        },
      },
    });

    if (!market) {
      throw new NotFoundError('Market');
    }

    return market;
  }

  async getMarketByType(type: MarketType) {
    return db.market.findFirst({
      where: { type: mapServerToPrismaMarketType(type) },
      include: {
        rounds: {
          take: 1,
          orderBy: { roundNumber: 'desc' },
          where: { status: 'PREDICTING' },
        },
      },
    });
  }

  async getActiveRounds() {
    return db.round.findMany({
      where: { status: 'PREDICTING' },
      include: {
        market: true,
        _count: {
          select: { bets: true },
        },
      },
      orderBy: { openedAt: 'asc' },
    });
  }

  async getMarketHistory(marketId: string, limit: number = 50) {
    const market = await db.market.findUnique({
      where: { id: marketId },
    });

    if (!market) {
      throw new NotFoundError('Market');
    }

    return db.round.findMany({
      where: { 
        marketId,
        status: 'SETTLED' 
      },
      include: {
        _count: {
          select: { bets: true },
        },
      },
      orderBy: { settledAt: 'desc' },
      take: limit,
    });
  }

  async updateHouseEdgeBps(marketId: string, houseEdgeBps: number, user: { id: string; walletAddress: string }) {
    if (houseEdgeBps < 0 || houseEdgeBps > 10000) {
      throw new ValidationError('houseEdgeBps must be between 0 and 10000');
    }

    const market = await db.market.findUnique({ where: { id: marketId } });
    if (!market) {
      throw new NotFoundError('Market');
    }

    const adminKeypair = getAdminKeypair();
    // Optional: restrict endpoint to admin wallet
    if (user.walletAddress.toLowerCase() !== adminKeypair.publicKey.toString().toLowerCase()) {
      throw new AuthenticationError('Admin only');
    }

    const cfg = getMarketConfig(market.config as unknown);
    const marketPubkey = new PublicKey(cfg.solanaAddress);

    // On-chain update
    const signature = await tossrProgram.setHouseEdgeBps(marketPubkey, houseEdgeBps, adminKeypair);

    // Mirror into DB config for server-side odds display
    const newConfig = { ...cfg, houseEdgeBps } as any;
    await db.market.update({ where: { id: marketId }, data: { config: newConfig } });

    return { marketId, houseEdgeBps, tx: signature };
  }

  async updateHouseEdgeBpsByType(type: string, houseEdgeBps: number, user: { id: string; walletAddress: string }) {
    if (houseEdgeBps < 0 || houseEdgeBps > 10000) {
      throw new ValidationError('houseEdgeBps must be between 0 and 10000');
    }

    const adminKeypair = getAdminKeypair();
    if (user.walletAddress.toLowerCase() !== adminKeypair.publicKey.toString().toLowerCase()) {
      throw new AuthenticationError('Admin only');
    }

    const markets = await db.market.findMany({ where: { type } });
    if (!markets.length) return { updated: 0, signatures: [] as string[] };

    const signatures: string[] = [];
    for (const market of markets) {
      const cfg = getMarketConfig(market.config as unknown);
      const marketPubkey = new PublicKey(cfg.solanaAddress);
      const sig = await tossrProgram.setHouseEdgeBps(marketPubkey, houseEdgeBps, adminKeypair);
      const newConfig = { ...cfg, houseEdgeBps } as any;
      await db.market.update({ where: { id: market.id }, data: { config: newConfig } });
      signatures.push(sig);
    }

    return { updated: markets.length, signatures };
  }
}
