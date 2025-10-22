import { db } from '@/config/database';
import { redis, redisKeys } from '@/config/redis';
import { BetStatus, MarketType, RoundStatus } from '@/shared/types';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors';
import { betQuerySchema } from '@/shared/schemas';
import { TossrProgramService } from '@/solana/tossr-program-service';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { PublicKey, Connection } from '@solana/web3.js';
import { getMarketConfig } from '@/utils/market-config';
import { mapPrismaToServerMarketType } from '@/utils/market-type-mapper';

const tossrProgram = new TossrProgramService();

export class BetsService {
  async createBetTransaction(
    userId: string,
    userWalletAddress: string,
    roundId: string,
    selection: any,
    stake: number
  ) {
    if (stake <= 0) {
      throw new ValidationError('Stake must be positive');
    }

    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (round.status !== RoundStatus.PREDICTING) {
      throw new ConflictError('Round is no longer accepting bets');
    }

    const now = Date.now();
    const roundOpenedAt = round.openedAt.getTime();
    const roundDuration = config.ROUND_DURATION_SECONDS * 1000;
    const lockBuffer = config.LOCK_DURATION_SECONDS * 1000;
    const timeRemaining = roundDuration - (now - roundOpenedAt);

    if (timeRemaining < lockBuffer) {
      throw new ConflictError('Round is closing soon, no new bets accepted');
    }

    this.validateSelection(selection, mapPrismaToServerMarketType(round.market.type as any));

    const marketConfig = getMarketConfig(round.market.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    const userPubkey = new PublicKey(userWalletAddress);
    if (!marketConfig.mintAddress) {
      throw new ValidationError('Missing mintAddress in market config');
    }
    const mint = new PublicKey(marketConfig.mintAddress);

    const selectionEncoded = this.encodeSelection(selection, mapPrismaToServerMarketType(round.market.type as any));

    const { transaction, betPda } = await tossrProgram.placeBet(
      userPubkey,
      marketPubkey,
      round.roundNumber,
      selectionEncoded,
      stake,
      mint
    );

    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    logger.info({
      userId,
      roundId,
      stake,
      betPda: betPda.toString(),
    }, 'Bet transaction created');

    return {
      transaction: serializedTransaction.toString('base64'),
      betPda: betPda.toString(),
      message: 'Sign this transaction in your wallet to place bet',
    };
  }

  async confirmBet(
    userId: string,
    roundId: string,
    selection: any,
    stake: number,
    txSignature: string,
    betPda: string
  ) {
    const cacheKey = `bet-confirm:${txSignature}`;
    const existingBetId = await redis.get(cacheKey);

    if (existingBetId) {
      const existingBet = await db.bet.findUnique({ where: { id: existingBetId } });
      if (existingBet) {
        return {
          ...existingBet,
          stake: Number(existingBet.stake),
          txSignature,
          betPda,
        };
      }
    }

    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (round.status !== RoundStatus.PREDICTING && round.status !== RoundStatus.LOCKED) {
      throw new ConflictError('Round is no longer accepting bet confirmations');
    }

    const connection = new Connection(config.SOLANA_RPC_URL);
    const txResult = await connection.getTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txResult || txResult.meta?.err) {
      throw new ValidationError('Transaction not found or failed on-chain');
    }

    const houseEdgeBps = (getMarketConfig(round.market.config as unknown) as any).houseEdgeBps ?? 0;

    const bet = await db.bet.create({
      data: {
        userId,
        roundId,
        marketId: round.marketId,
        selection,
        stake: BigInt(stake),
        odds: this.calculateOdds(selection, mapPrismaToServerMarketType(round.market.type as any), houseEdgeBps),
        status: BetStatus.PENDING,
      },
    });

    await redis.set(cacheKey, bet.id, 'EX', 86400);

    await redis.hset(
      redisKeys.roundBets(roundId),
      bet.id,
      JSON.stringify({
        ...bet,
        txSignature,
        betPda,
      })
    );

    await redis.incr(redisKeys.betCount(roundId));

    logger.info({
      betId: bet.id,
      userId,
      roundId,
      txSignature,
      betPda,
    }, 'Bet confirmed on-chain');

    return {
      ...bet,
      stake: Number(bet.stake),
      txSignature,
      betPda,
    };
  }

  private encodeSelection(selection: any, marketType: MarketType): { kind: number; a: number; b: number; c: number } {
    switch (marketType) {
      case MarketType.PICK_RANGE:
        if (selection.type === 'range') {
          return { kind: 0, a: selection.min, b: selection.max, c: 0 };
        } else {
          return { kind: 1, a: selection.value, b: 0, c: 0 };
        }

      case MarketType.EVEN_ODD:
        return { kind: 2, a: selection.value === 'even' ? 0 : 1, b: 0, c: 0 };

      case MarketType.LAST_DIGIT:
        return { kind: 3, a: selection.value, b: 0, c: 0 };

      case MarketType.MODULO_THREE:
        return { kind: 4, a: selection.value, b: 0, c: 0 };

      case MarketType.PATTERN_OF_DAY:
        return { kind: 5, a: selection.patternId || 0, b: 0, c: 0 };

      case MarketType.SHAPE_COLOR:
        return { kind: 6, a: selection.shape, b: selection.color, c: selection.size };

      case MarketType.ENTROPY_BATTLE:
        const sourceMap: Record<string, number> = { tee: 0, chain: 1, sensor: 2 };
        return { kind: 7, a: sourceMap[selection.source] ?? 0, b: 0, c: 0 };

      case MarketType.STREAK_METER:
        return { kind: 8, a: selection.target, b: 0, c: 0 };

      case MarketType.COMMUNITY_SEED:
        return { kind: 9, a: selection.byte, b: 0, c: 0 };

      default:
        throw new ValidationError('Invalid market type');
    }
  }

  private calculateOdds(selection: any, marketType: MarketType, houseEdgeBps: number = 0): number {
    const edge = Math.min(Math.max(houseEdgeBps, 0), 10000);
    const edgeFactor = 10000 / (10000 + edge); // (1 / (1 + edge))

    const fromEqualBins = (n: number) => Math.max(1, Math.floor(n * edgeFactor * 100) / 100);
    const fromProbability = (num: number, den: number) => {
      if (!num || !den) return 0;
      const m = (den / num) * edgeFactor;
      return Math.max(1, Math.floor(m * 100) / 100);
    };

    switch (marketType) {
      case MarketType.PICK_RANGE:
        if (selection.type === 'range') {
          const width = selection.max - selection.min + 1;
          if (width > 0 && 100 % width === 0) {
            return fromEqualBins(100 / width);
          }
          return fromProbability(width, 100);
        }
        if (selection.type === 'single') {
          return fromEqualBins(100);
        }
        return fromEqualBins(2);

      case MarketType.EVEN_ODD:
        return fromEqualBins(2);

      case MarketType.LAST_DIGIT:
        return fromEqualBins(10);

      case MarketType.MODULO_THREE:
        return fromEqualBins(3);

      case MarketType.JACKPOT:
        return fromEqualBins(100);

      case MarketType.ENTROPY_BATTLE:
        return fromEqualBins(3);

      case MarketType.SHAPE_COLOR: {
        const shapes = selection.shape === undefined ? 4 : 1;
        const colors = selection.color === undefined ? 6 : 1;
        const sizes = selection.size === undefined ? 3 : 1;
        const matched = shapes * colors * sizes;
        return fromProbability(matched, 72);
      }

      case MarketType.PATTERN_OF_DAY: {
        // precedence-adjusted counts for 0..999
        const counts = [168, 10, 29, 52, 73, 437, 231];
        // map selection.patternId to index: prime=0, fib=1, square=2, endsWith7=3, palindrome=4, even=5, odd=6
        const idx = typeof selection.patternId === 'number' ? selection.patternId : 6;
        const num = counts[idx] ?? counts[6];
        return fromProbability(num, 1000);
      }

      case MarketType.COMMUNITY_SEED: {
        const t = Math.max(0, Math.min(8, selection.tolerance ?? selection.t ?? 0));
        const choose = (n: number, k: number) => {
          if (k < 0 || k > n) return 0;
          k = Math.min(k, n - k);
          let numer = 1, denom = 1;
          for (let i = 0; i < k; i++) { numer *= (n - i); denom *= (i + 1); }
          return Math.floor(numer / denom);
        };
        let num = 0;
        for (let k = 0; k <= t; k++) num += choose(8, k);
        return fromProbability(num, 256);
      }

      default:
        return fromEqualBins(2);
    }
  }

  private validateSelection(selection: any, marketType: MarketType) {
    if (!selection || !selection.type) {
      throw new ValidationError('Invalid bet selection format');
    }

    switch (marketType) {
      case MarketType.PICK_RANGE:
        if (selection.type === 'range') {
          if (selection.min < 1 || selection.max > 100 || selection.min > selection.max) {
            throw new ValidationError('Invalid range selection');
          }
        } else if (selection.type === 'single') {
          if (selection.value < 1 || selection.value > 100) {
            throw new ValidationError('Invalid single number selection');
          }
        }
        break;

      case MarketType.EVEN_ODD:
        if (!['even', 'odd'].includes(selection.value)) {
          throw new ValidationError('Invalid parity selection');
        }
        break;

      case MarketType.LAST_DIGIT:
        if (selection.value < 0 || selection.value > 9) {
          throw new ValidationError('Invalid digit selection');
        }
        break;

      case MarketType.MODULO_THREE:
        if (selection.value < 0 || selection.value > 2) {
          throw new ValidationError('Invalid modulo selection');
        }
        break;

      case MarketType.ENTROPY_BATTLE:
        if (!['tee', 'chain', 'sensor'].includes(selection.source)) {
          throw new ValidationError('Invalid entropy source selection');
        }
        break;

      case MarketType.STREAK_METER:
        if (selection.target < 2 || selection.target > config.MAX_STREAK_TARGET) {
          throw new ValidationError('Invalid streak target');
        }
        break;

      case MarketType.COMMUNITY_SEED:
        if (selection.byte < 0 || selection.byte > 255) {
          throw new ValidationError('Invalid community seed byte');
        }
        break;

      default:
        throw new ValidationError('Invalid market type');
    }
  }

  async getUserBets(userId: string, options: any = {}) {
    const { page = 1, limit = 20, status, marketId } = betQuerySchema.parse(options);

    const where: any = { userId };
    if (status) where.status = status;
    if (marketId) where.marketId = marketId;

    const [bets, total] = await Promise.all([
      db.bet.findMany({
        where,
        include: {
          round: {
            select: {
              id: true,
              roundNumber: true,
              status: true,
              settledAt: true,
              market: {
                select: {
                  name: true,
                  type: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.bet.count({ where }),
    ]);

    return {
      items: bets.map((bet: any) => ({
        ...bet,
        stake: Number(bet.stake),
        payout: bet.payout ? Number(bet.payout) : null,
      })),
      total,
      page,
      limit,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    };
  }

  async getRoundBets(roundId: string, userId?: string) {
    let bets: any[];

    if (userId) {
      // Get specific user's bets for this round
      bets = await db.bet.findMany({
        where: { roundId, userId },
        include: {
          round: {
            select: {
              id: true,
              roundNumber: true,
              status: true,
              market: {
                select: {
                  name: true,
                  type: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      // Get all bets for this round (admin/owner only)
      bets = await db.bet.findMany({
        where: { roundId },
        include: {
          user: {
            select: {
              id: true,
              walletAddress: true,
            },
          },
          round: {
            select: {
              id: true,
              roundNumber: true,
              status: true,
              market: {
                select: {
                  name: true,
                  type: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return bets.map(bet => ({
      ...bet,
      stake: Number(bet.stake),
      payout: bet.payout ? Number(bet.payout) : null,
    }));
  }

  async getBetStats(userId?: string, marketId?: string) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (marketId) where.marketId = marketId;

    const [
      totalBets,
      wonBets,
      totalStake,
      totalPayout,
      pendingBets,
    ] = await Promise.all([
      db.bet.count({ where }),
      db.bet.count({ where: { ...where, status: 'WON' } }),
      db.bet.aggregate({
        where,
        _sum: { stake: true },
      }),
      db.bet.aggregate({
        where: { ...where, status: 'WON' },
        _sum: { payout: true },
      }),
      db.bet.count({ where: { ...where, status: 'PENDING' } }),
    ]);

    const winRate = totalBets > 0 ? (wonBets / totalBets) * 100 : 0;
    const totalStaked = Number(totalStake._sum.stake || 0);
    const totalPaid = Number(totalPayout._sum.payout || 0);
    const profitLoss = totalPaid - totalStaked;

    return {
      totalBets,
      wonBets,
      pendingBets,
      winRate: Math.round(winRate * 100) / 100,
      totalStaked,
      totalPaid,
      profitLoss,
    };
  }

  async refundBets(roundId: string, reason: string) {
    const bets = await db.bet.findMany({
      where: { 
        roundId,
        status: BetStatus.PENDING 
      },
    });

    const refunds = await Promise.all(
      bets.map(async (bet: any) => {
        await db.bet.update({
          where: { id: bet.id },
          data: {
            status: BetStatus.REFUNDED,
            payout: bet.stake,
          },
        });

        logger.info(`Bet refunded: ${bet.id} - Reason: ${reason}`);

        return {
          betId: bet.id,
          stake: Number(bet.stake),
        };
      })
    );

    return refunds;
  }
}
