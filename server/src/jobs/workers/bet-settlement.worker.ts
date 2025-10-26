import { Job } from 'bullmq';
import { createWorker } from '../queue-config';
import { Round, Bet, LeaderboardEntry } from '@/config/database';
import { BetStatus, RoundStatus } from '@/shared/types';
import { logger } from '@/utils/logger';
import { SettleBetsJobData } from '../queues';
import { TossrProgramService } from '@/solana/tossr-program-service';
import { getMarketConfig } from '@/utils/market-config';
import { getAdminKeypair } from '@/config/admin-keypair';
import { PublicKey } from '@solana/web3.js';

const tossrProgram = new TossrProgramService();

async function processBetSettlementJob(job: Job<SettleBetsJobData>) {
  const { roundId } = job.data;

  logger.info({ roundId }, 'Processing bet settlement job');

  const round = await Round.findById(roundId).populate({ path: 'marketId', model: 'Market' }).lean();
  const pendingBets = await Bet.find({ roundId, status: BetStatus.PENDING })
    .populate({ path: 'userId', select: 'walletAddress', model: 'User' })
    .lean();

  if (!round || !(round as any).outcome) {
    throw new Error(`Round ${roundId} not found or outcome not available`);
  }

  const outcome = typeof (round as any).outcome === 'string' ? JSON.parse((round as any).outcome as any) : (round as any).outcome;

  const marketCfg = getMarketConfig((round as any).marketId.config as unknown);
  if (!marketCfg.mintAddress) {
    throw new Error('Missing mintAddress in market config');
  }

  const adminKeypair = getAdminKeypair();
  const marketPubkey = new PublicKey(marketCfg.solanaAddress);
  const mint = new PublicKey(marketCfg.mintAddress);

  for (const bet of pendingBets as any[]) {
    const won = checkBetWon(bet.selection as any, outcome, (round as any).marketId.type);
    const payout = won ? Number(bet.stake) * Number(bet.odds) : 0;

    // Settle on-chain; program computes win + payout and transfers from vault
    try {
      const userPk = new PublicKey(bet.userId.walletAddress);
      await tossrProgram.settleBet(
        marketPubkey,
        round.roundNumber,
        userPk,
        mint,
        adminKeypair
      );
    } catch (e) {
      logger.error({ betId: bet._id, err: e }, 'On-chain settle failed');
      // Continue with DB update; system remains eventually consistent
    }

    await Bet.updateOne({ _id: bet._id }, { $set: { status: won ? BetStatus.WON : BetStatus.LOST, payout } });

    // Update leaderboard
    if (won) {
      await updateLeaderboard(String(bet.userId._id ?? bet.userId), Number(bet.stake), payout);
    }

    logger.info({ betId: bet._id, won, payout }, 'Bet settled (on-chain + DB)');
  }

  await Round.updateOne({ _id: roundId }, { $set: { status: RoundStatus.SETTLED } });

  try {
    await tossrProgram.settleRound(marketPubkey, round.roundNumber, adminKeypair);
  } catch (e) {
    logger.error({ roundId, err: e }, 'On-chain round settle failed');
  }

  try {
    const undelegateTxHash = await tossrProgram.commitAndUndelegateRound(
      marketPubkey,
      round.roundNumber,
      adminKeypair
    );
    await Round.updateOne({ _id: roundId }, { $set: { undelegateTxHash, settledAt: new Date() } });
    logger.info({ roundId, undelegateTxHash }, 'Round committed and undelegated');
  } catch (e) {
    logger.error({ roundId, err: e }, 'Commit and undelegate failed');
  }

  logger.info({ roundId }, 'All bets settled for round');
}

function checkBetWon(selection: any, outcome: any, marketType: string): boolean {
  if (outcome.Numeric) {
    const value = outcome.Numeric.value;

    switch (selection.type) {
      case 'range':
        return value >= selection.min && value <= selection.max;
      case 'single':
        return value === selection.value;
      case 'parity':
        return (value % 2 === 0 && selection.value === 'even') ||
               (value % 2 === 1 && selection.value === 'odd');
      case 'digit':
        return value % 10 === selection.value;
      case 'modulo':
        return value % 3 === selection.value;
      default:
        return false;
    }
  }

  if (outcome.Shape) {
    return selection.type === 'shape' &&
           selection.shape === outcome.Shape.shape &&
           (!selection.color || selection.color === outcome.Shape.color);
  }

  if (outcome.Pattern) {
    return selection.type === 'pattern' &&
           selection.patternId === outcome.Pattern.pattern_id;
  }

  if (outcome.Entropy) {
    return selection.type === 'entropy' &&
           outcome.Entropy.winner === parseEntropySource(selection.source);
  }

  if (outcome.Community) {
    return selection.type === 'community' &&
           selection.byte === outcome.Community.final_byte;
  }

  return false;
}

function parseEntropySource(source: string): number {
  switch (source) {
    case 'tee': return 0;
    case 'chain': return 1;
    case 'sensor': return 2;
    default: return -1;
  }
}

async function updateLeaderboard(userId: string, stake: number, payout: number) {
  await LeaderboardEntry.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: { userId, totalBets: 0, totalWon: 0, totalStake: 0, totalPayout: 0, winRate: 0, streak: 0 },
      $inc: { totalBets: 1, totalWon: 1, totalStake: stake, totalPayout: payout },
    },
    { upsert: true }
  );
}

export const betSettlementWorker = createWorker<SettleBetsJobData>(
  'bet-settlement',
  processBetSettlementJob
);
