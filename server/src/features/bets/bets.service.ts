import { Bet, Round } from '@/config/database';
import { redis, redisKeys } from '@/config/redis';
import { BetStatus, MarketType, RoundStatus } from '@/shared/types';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors';
import { betQuerySchema } from '@/shared/schemas';
import { TossrProgramService } from '@/solana/tossr-program-service';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { PublicKey, Connection } from '@solana/web3.js';
import { getMarketConfig } from '@/utils/market-config';

const tossrProgram = new TossrProgramService();

export class BetsService {
  async createBetTransaction(
    userId: string,
    userWalletAddress: string,
    roundId: string,
    selection: any,
    stake: number
  ) {
    if (stake <= 0) throw new ValidationError('Stake must be positive');

    const round = await Round.findById(roundId)
      .populate({ path: 'marketId', model: 'Market' })
      .lean();

    if (!round) throw new NotFoundError('Round');
    if (round.status !== RoundStatus.PREDICTING) throw new ConflictError('Round is no longer accepting bets');
    if (!round.openedAt) throw new ConflictError('Round has not started accepting bets');

    const now = Date.now();
    const roundOpenedAt = new Date(round.openedAt).getTime();
    const roundDuration = config.ROUND_DURATION_SECONDS * 1000;
    const lockBuffer = config.LOCK_DURATION_SECONDS * 1000;
    const timeRemaining = roundDuration - (now - roundOpenedAt);
    if (timeRemaining < lockBuffer) throw new ConflictError('Round is closing soon, no new bets accepted');

    this.validateSelection(selection, (round.marketId as any).type as MarketType);

    const marketConfig = getMarketConfig((round.marketId as any).config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    const userPubkey = new PublicKey(userWalletAddress);
    if (!marketConfig.mintAddress) throw new ValidationError('Missing mintAddress in market config');
    const mint = new PublicKey(marketConfig.mintAddress);

    const selectionEncoded = this.encodeSelection(selection, ((round.marketId as any).type) as MarketType);

    const { transaction, betPda } = await tossrProgram.placeBet(
      userPubkey,
      marketPubkey,
      round.roundNumber,
      selectionEncoded,
      stake,
      mint
    );

    const serializedTransaction = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });

    logger.info({ userId, roundId, stake, betPda: betPda.toString() }, 'Bet transaction created');

    return { transaction: serializedTransaction.toString('base64'), betPda: betPda.toString(), message: 'Sign this transaction in your wallet to place bet' };
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
      const existingBet = await Bet.findById(existingBetId).lean();
      if (existingBet) {
        return { ...existingBet, stake: Number(existingBet.stake), txSignature, betPda } as any;
      }
    }

    const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();
    if (!round) throw new NotFoundError('Round');
    if (round.status !== RoundStatus.PREDICTING && round.status !== RoundStatus.LOCKED) {
      throw new ConflictError('Round is no longer accepting bet confirmations');
    }

    const connection = new Connection(config.SOLANA_RPC_URL);
    const txResult = await connection.getTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
    if (!txResult || txResult.meta?.err) throw new ValidationError('Transaction not found or failed on-chain');

    const cfg = getMarketConfig((round.marketId as any).config as unknown) as any;
    const houseEdgeBps: number = typeof cfg?.houseEdgeBps === 'number' ? cfg.houseEdgeBps : 0;

    const bet = await Bet.create({
      userId,
      roundId,
      marketId: round.marketId,
      selection,
      stake,
      odds: this.calculateOdds(selection, ((round.marketId as any).type) as MarketType, houseEdgeBps),
      status: BetStatus.PENDING,
    });

    await redis.set(cacheKey, (bet as any).id || (bet as any)._id.toString(), 'EX', 86400);
    await redis.hset(
      redisKeys.roundBets(roundId),
      (bet as any).id || (bet as any)._id.toString(),
      JSON.stringify({ ...bet.toObject?.() || bet, txSignature, betPda })
    );
    await redis.incr(redisKeys.betCount(roundId));

    logger.info({ betId: (bet as any).id || (bet as any)._id.toString(), userId, roundId, txSignature, betPda }, 'Bet confirmed on-chain');

    return { ...(bet.toObject?.() || bet), stake: Number(bet.stake), txSignature, betPda } as any;
  }

  private encodeSelection(selection: any, marketType: MarketType): { kind: number; a: number; b: number; c: number } {
    switch (marketType) {
      case MarketType.PICK_RANGE:
        if (selection.type === 'range') return { kind: 0, a: selection.min, b: selection.max, c: 0 };
        else return { kind: 1, a: selection.value, b: 0, c: 0 };
      case MarketType.EVEN_ODD:
        return { kind: 2, a: selection.value === 'even' ? 0 : 1, b: 0, c: 0 };
      case MarketType.LAST_DIGIT:
        return { kind: 3, a: selection.value, b: 0, c: 0 };
      case MarketType.MODULO_THREE:
        return { kind: 4, a: selection.value, b: 0, c: 0 };
      case MarketType.PATTERN_OF_DAY:
        return { kind: 5, a: selection.patternId || 0, b: 0, c: 0 };
      case MarketType.SHAPE_COLOR:
        return { kind: 6, a: (selection.shape ?? 255), b: (selection.color ?? 255), c: (selection.size ?? 255) };
      case MarketType.ENTROPY_BATTLE: {
        const sourceMap: Record<string, number> = { tee: 0, chain: 1, sensor: 2 };
        return { kind: 7, a: sourceMap[selection.source] ?? 0, b: 0, c: 0 };
      }
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
    const edgeFactor = 10000 / (10000 + edge);
    const fromEqualBins = (n: number) => Math.max(1, Math.floor(n * edgeFactor * 100) / 100);
    const fromProbability = (num: number, den: number) => { if (!num || !den) return 0; const m = (den / num) * edgeFactor; return Math.max(1, Math.floor(m * 100) / 100); };

    switch (marketType) {
      case MarketType.PICK_RANGE:
        if (selection.type === 'range') { const width = selection.max - selection.min + 1; if (width > 0 && 100 % width === 0) return fromEqualBins(100 / width); return fromProbability(width, 100); }
        if (selection.type === 'single') return fromEqualBins(100); return fromEqualBins(2);
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
        const counts = [168, 10, 29, 52, 73, 437, 231];
        const idx = typeof selection.patternId === 'number' ? selection.patternId : 6;
        const num = counts[idx] !== undefined ? counts[idx] : counts[6];
        return fromProbability(num as number, 1000);
      }
      case MarketType.COMMUNITY_SEED: {
        const t = Math.max(0, Math.min(8, selection.tolerance ?? selection.t ?? 0));
        const choose = (n: number, k: number) => { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let numer = 1, denom = 1; for (let i = 0; i < k; i++) { numer *= (n - i); denom *= (i + 1); } return Math.floor(numer / denom); };
        let num = 0; for (let k = 0; k <= t; k++) num += choose(8, k); return fromProbability(num, 256);
      }
      default:
        return fromEqualBins(2);
    }
  }

  private validateSelection(selection: any, marketType: MarketType) {
    if (!selection || !selection.type) throw new ValidationError('Invalid bet selection format');
    switch (marketType) {
      case MarketType.PICK_RANGE:
        if (selection.type === 'range') {
          if (selection.min < 1 || selection.max > 100 || selection.min > selection.max) throw new ValidationError('Invalid range selection');
        } else if (selection.type === 'single') {
          if (selection.value < 1 || selection.value > 100) throw new ValidationError('Invalid single number selection');
        }
        break;
      case MarketType.EVEN_ODD:
        if (!['even', 'odd'].includes(selection.value)) throw new ValidationError('Invalid parity selection');
        break;
      case MarketType.LAST_DIGIT:
        if (selection.value < 0 || selection.value > 9) throw new ValidationError('Invalid digit selection');
        break;
      case MarketType.MODULO_THREE:
        if (selection.value < 0 || selection.value > 2) throw new ValidationError('Invalid modulo selection');
        break;
      case MarketType.PATTERN_OF_DAY: {
        const pid = Number(selection.patternId);
        if (!Number.isInteger(pid) || pid < 0 || pid > 6) throw new ValidationError('Invalid pattern selection');
        break;
      }
      case MarketType.SHAPE_COLOR: {
        const validByte = (n: any) => n === undefined || (Number.isInteger(n) && n >= 0 && n <= 255);
        if (!validByte(selection.shape) || !validByte(selection.color) || !validByte(selection.size)) {
          throw new ValidationError('Invalid shape selection');
        }
        break;
      }
      case MarketType.ENTROPY_BATTLE:
        if (!['tee', 'chain', 'sensor'].includes(selection.source)) throw new ValidationError('Invalid entropy source selection');
        break;
      case MarketType.STREAK_METER:
        if (selection.target < 2 || selection.target > config.MAX_STREAK_TARGET) throw new ValidationError('Invalid streak target');
        break;
      case MarketType.COMMUNITY_SEED:
        if (selection.byte < 0 || selection.byte > 255) throw new ValidationError('Invalid community seed byte');
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
      Bet.find(where)
        .populate({ path: 'roundId', select: 'id roundNumber status settledAt marketId', populate: { path: 'marketId', select: 'name type' }, model: 'Round' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Bet.countDocuments(where),
    ]);

    return {
      items: bets.map((bet: any) => ({
        ...bet,
        stake: Number(bet.stake),
        payout: bet.payout != null ? Number(bet.payout) : null,
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
      bets = await Bet.find({ roundId, userId })
        .populate({ path: 'roundId', select: 'id roundNumber status marketId', populate: { path: 'marketId', select: 'name type' }, model: 'Round' })
        .sort({ createdAt: -1 })
        .lean();
    } else {
      bets = await Bet.find({ roundId })
        .populate({ path: 'userId', select: 'id walletAddress', model: 'User' })
        .populate({ path: 'roundId', select: 'id roundNumber status marketId', populate: { path: 'marketId', select: 'name type' }, model: 'Round' })
        .sort({ createdAt: -1 })
        .lean();
    }
    return bets.map(bet => ({ ...bet, stake: Number(bet.stake), payout: bet.payout != null ? Number(bet.payout) : null }));
  }

  async getBetStats(userId?: string, marketId?: string) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (marketId) where.marketId = marketId;

    const [totalBets, wonBets, totalStake, totalPayout, pendingBets] = await Promise.all([
      Bet.countDocuments(where),
      Bet.countDocuments({ ...where, status: 'WON' }),
      Bet.aggregate([{ $match: where }, { $group: { _id: null, total: { $sum: '$stake' } } }]),
      Bet.aggregate([{ $match: { ...where, status: 'WON' } }, { $group: { _id: null, total: { $sum: '$payout' } } }]),
      Bet.countDocuments({ ...where, status: 'PENDING' }),
    ]);

    const winRate = totalBets > 0 ? (wonBets / totalBets) * 100 : 0;
    const totalStaked = Number(totalStake[0]?.total || 0);
    const totalPaid = Number(totalPayout[0]?.total || 0);
    const profitLoss = totalPaid - totalStaked;

    return { totalBets, wonBets, pendingBets, winRate: Math.round(winRate * 100) / 100, totalStaked, totalPaid, profitLoss };
  }

  async refundBets(roundId: string, reason: string) {
    const bets = await Bet.find({ roundId, status: BetStatus.PENDING }).lean();
    const refunds = await Promise.all(
      bets.map(async (bet: any) => {
        await Bet.updateOne({ _id: bet._id }, { $set: { status: BetStatus.REFUNDED, payout: bet.stake } });
        logger.info(`Bet refunded: ${bet._id} - Reason: ${reason}`);
        return { betId: bet._id.toString(), stake: Number(bet.stake) };
      })
    );
    return refunds;
  }
}
