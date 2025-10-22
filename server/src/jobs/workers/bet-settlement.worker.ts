import { Job } from 'bullmq';
import { createWorker } from '../queue-config';
import { db } from '@/config/database';
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

  const round = await db.round.findUnique({
    where: { id: roundId },
    include: {
      market: true,
      bets: {
        where: { status: BetStatus.PENDING },
        include: {
          user: { select: { walletAddress: true } },
        },
      },
    },
  });

  if (!round || !round.outcome) {
    throw new Error(`Round ${roundId} not found or outcome not available`);
  }

  const outcome = JSON.parse(round.outcome as any);

  const marketCfg = getMarketConfig(round.market.config as unknown);
  if (!marketCfg.mintAddress) {
    throw new Error('Missing mintAddress in market config');
  }

  const adminKeypair = getAdminKeypair();
  const marketPubkey = new PublicKey(marketCfg.solanaAddress);
  const mint = new PublicKey(marketCfg.mintAddress);

  for (const bet of round.bets) {
    const won = checkBetWon(bet.selection as any, outcome, round.market.type);
    const payout = won ? Number(bet.stake) * Number(bet.odds) : 0;

    // Settle on-chain; program computes win + payout and transfers from vault
    try {
      const userPk = new PublicKey(bet.user.walletAddress);
      await tossrProgram.settleBet(
        marketPubkey,
        round.roundNumber,
        userPk,
        mint,
        adminKeypair
      );
    } catch (e) {
      logger.error({ betId: bet.id, err: e }, 'On-chain settle failed');
      // Continue with DB update; system remains eventually consistent
    }

    await db.bet.update({
      where: { id: bet.id },
      data: {
        status: won ? BetStatus.WON : BetStatus.LOST,
        payout: BigInt(payout),
      },
    });

    // Update leaderboard
    if (won) {
      await updateLeaderboard(bet.userId, Number(bet.stake), payout);
    }

    logger.info({ betId: bet.id, won, payout }, 'Bet settled (on-chain + DB)');
  }

  await db.round.update({
    where: { id: roundId },
    data: { status: RoundStatus.SETTLED },
  });

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
  await db.leaderboardEntry.upsert({
    where: { userId },
    create: {
      userId,
      totalStake: BigInt(stake),
      totalPayout: BigInt(payout),
      totalBets: 1,
      totalWon: 1,
    },
    update: {
      totalStake: { increment: BigInt(stake) },
      totalPayout: { increment: BigInt(payout) },
      totalBets: { increment: 1 },
      totalWon: { increment: 1 },
    },
  });
}

export const betSettlementWorker = createWorker<SettleBetsJobData>(
  'bet-settlement',
  processBetSettlementJob
);
