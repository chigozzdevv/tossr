import { db } from '@/config/database';
import { NotFoundError } from '@/shared/errors';

export class UserService {
  async getProfile(userId: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            bets: true,
            streaks: true,
            communitySeeds: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User');
    }

    const [stats, leaderboard] = await Promise.all([
      this.getUserStats(userId),
      db.leaderboardEntry.findUnique({ where: { userId } }),
    ]);

    return {
      id: user.id,
      walletAddress: user.walletAddress,
      createdAt: user.createdAt,
      stats: {
        totalBets: user._count.bets,
        totalStreaks: user._count.streaks,
        totalCommunityParticipations: user._count.communitySeeds,
        ...stats,
      },
      leaderboard: leaderboard ? {
        totalWon: leaderboard.totalWon,
        winRate: leaderboard.winRate,
        streak: leaderboard.streak,
        totalPayout: Number(leaderboard.totalPayout),
      } : null,
    };
  }

  async getUserStats(userId: string) {
    const [
      wonBets,
      totalStake,
      totalPayout,
      activeStreaks,
      completedStreaks,
      communityWins,
    ] = await Promise.all([
      db.bet.count({ where: { userId, status: 'WON' } }),
      db.bet.aggregate({
        where: { userId },
        _sum: { stake: true },
      }),
      db.bet.aggregate({
        where: { userId, status: 'WON' },
        _sum: { payout: true },
      }),
      db.streak.count({ where: { userId, status: 'ACTIVE' } }),
      db.streak.count({ where: { userId, status: 'COMPLETED' } }),
      db.communitySeed.count({ where: { userId, won: true } }),
    ]);

    const totalStaked = Number(totalStake._sum.stake || 0);
    const totalPaid = Number(totalPayout._sum.payout || 0);
    const profitLoss = totalPaid - totalStaked;

    return {
      wonBets,
      totalStaked,
      totalPaid,
      profitLoss,
      activeStreaks,
      completedStreaks,
      communityWins,
    };
  }

  async getBetHistory(userId: string, options: { page?: number; limit?: number; marketId?: string } = {}) {
    const { page = 1, limit = 20, marketId } = options;

    const where: any = { userId };
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
              outcome: true,
              settledAt: true,
              market: {
                select: {
                  id: true,
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
        id: bet.id,
        selection: bet.selection,
        stake: Number(bet.stake),
        odds: bet.odds,
        status: bet.status,
        payout: bet.payout ? Number(bet.payout) : null,
        createdAt: bet.createdAt,
        round: bet.round,
      })),
      total,
      page,
      limit,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    };
  }

  async getStreakHistory(userId: string, options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = options;

    const [streaks, total] = await Promise.all([
      db.streak.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.streak.count({ where: { userId } }),
    ]);

    return {
      items: streaks,
      total,
      page,
      limit,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    };
  }

  async getCommunityHistory(userId: string, options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 20 } = options;

    const [seeds, total] = await Promise.all([
      db.communitySeed.findMany({
        where: { userId },
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
      db.communitySeed.count({ where: { userId } }),
    ]);

    return {
      items: seeds,
      total,
      page,
      limit,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    };
  }

  async getRecentActivity(userId: string, limit: number = 10) {
    const [recentBets, recentStreaks, recentCommunity] = await Promise.all([
      db.bet.findMany({
        where: { userId },
        include: {
          round: {
            select: {
              roundNumber: true,
              market: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      db.streak.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        take: limit,
      }),
      db.communitySeed.findMany({
        where: { userId },
        include: {
          round: {
            select: {
              roundNumber: true,
              market: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    return {
      recentBets: recentBets.map((bet: any) => ({
        type: 'bet',
        id: bet.id,
        stake: Number(bet.stake),
        status: bet.status,
        market: bet.round.market.name,
        roundNumber: bet.round.roundNumber,
        createdAt: bet.createdAt,
      })),
      recentStreaks: recentStreaks.map((streak: any) => ({
        type: 'streak',
        id: streak.id,
        currentStreak: streak.currentStreak,
        target: streak.target,
        status: streak.status,
        startedAt: streak.startedAt,
      })),
      recentCommunity: recentCommunity.map((seed: any) => ({
        type: 'community',
        id: seed.id,
        byte: seed.byte,
        won: seed.won,
        distance: seed.distance,
        market: seed.round.market.name,
        roundNumber: seed.round.roundNumber,
        createdAt: seed.createdAt,
      })),
    };
  }
}
