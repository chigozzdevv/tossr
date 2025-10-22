import { db } from '@/config/database';
import { redis } from '@/config/redis';
import { RoundStatus } from '@/shared/types';
import { NotFoundError, ValidationError, ConflictError } from '@/shared/errors';
import { TeeService } from '@/solana/tee-service';
import { logger } from '@/utils/logger';

const teeService = new TeeService();

export class CommunityService {
  async joinCommunityRound(userId: string, roundId: string, byte: number) {
    if (byte < 0 || byte > 255) {
      throw new ValidationError('Byte must be between 0 and 255');
    }

    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (round.status !== RoundStatus.PREDICTING) {
      throw new ConflictError('Round is no longer accepting community seeds');
    }

    // Check if user already joined this round
    const existingSeed = await db.communitySeed.findUnique({
      where: {
        userId_roundId: {
          userId,
          roundId,
        },
      },
    });

    if (existingSeed) {
      throw new ConflictError('User already joined this community round');
    }

    // Add community seed
    const communitySeed = await db.communitySeed.create({
      data: {
        userId,
        roundId,
        byte,
      },
    });

    // Cache in Redis for real-time access
    await redis.hset(
      redisKeys.communityRound(roundId),
      userId,
      JSON.stringify({
        byte,
        joinedAt: communitySeed.createdAt,
      })
    );

    // Increment participant count
    await redis.incr(redisKeys.communityCount(roundId));

    logger.info(`User joined community round: ${userId} - Round: ${roundId} - Byte: ${byte}`);

    return communitySeed;
  }

  async finalizeCommunityRound(roundId: string) {
    const seeds = await db.communitySeed.findMany({
      where: { roundId },
      orderBy: { createdAt: 'asc' },
    });

    if (seeds.length === 0) {
      throw new ValidationError('No community seeds found for this round');
    }

    const seedBytes = seeds.map((seed: { byte: number }) => seed.byte);

    const teeAttestation = await teeService.generateOutcome(
      roundId,
      'CommunitySeed',
      { communitySeeds: seedBytes }
    );

    const { final_byte: finalByte, seed_hash } = teeAttestation.outcome;
    const finalHash = Buffer.from(seed_hash).toString('hex');

    const seededWithDistance = await Promise.all(
      seeds.map(async (seed: { id: string; byte: number; userId: string; roundId: string; createdAt: Date }) => {
        const distance = this.calculateHammingDistance(seed.byte, finalByte);

        await db.communitySeed.update({
          where: { id: seed.id },
          data: { distance, won: distance === 0 },
        });

        return {
          ...seed,
          distance,
          won: distance === 0,
        };
      })
    );

    const winners = seededWithDistance.filter((seed: { won?: boolean }) => seed.won);

    const closestWinners = winners.length > 0 ? winners :
      seededWithDistance
        .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
        .slice(0, 1);

    const result = {
      type: 'community',
      finalByte,
      finalHash,
      participants: seeds.length,
      winners: closestWinners.map(w => ({
        userId: w.userId,
        byte: w.byte,
        distance: w.distance,
      })),
    };

    return {
      ...result,
      seedBytes,
      seededWithDistance,
    };
  }

  private calculateHammingDistance(byte1: number, byte2: number): number {
    // Calculate Hamming distance between two bytes (8-bit)
    let xor = byte1 ^ byte2;
    let distance = 0;
    
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
    
    return distance;
  }

  async getCommunityRoundParticipants(roundId: string) {
    const seeds = await db.communitySeed.findMany({
      where: { roundId },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const total = seeds.length;
    const minByte = Math.min(...seeds.map((s: { byte: number }) => s.byte));
    const maxByte = Math.max(...seeds.map((s: { byte: number }) => s.byte));
    const avgByte = seeds.reduce((sum: number, s: { byte: number }) => sum + s.byte, 0) / total;

    return {
      participants: seeds,
      stats: {
        total,
        minByte,
        maxByte,
        avgByte: Math.round(avgByte * 100) / 100,
      },
    };
  }

  async getUserCommunityHistory(userId: string, options: any = {}) {
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

  async getCommunityStats(userId?: string) {
    const userFilter = userId ? { userId } : {};

    const [
      totalParticipations,
      totalWins,
      totalRounds,
      avgDistance,
    ] = await Promise.all([
      db.communitySeed.count({ where: userFilter }),
      db.communitySeed.count({ where: { ...userFilter, won: true } }),
      db.round.count({
        where: {
          status: RoundStatus.SETTLED,
          communitySeeds: { some: userFilter },
        },
      }),
      db.communitySeed.aggregate({
        where: { ...userFilter, distance: { not: null } },
        _avg: { distance: true },
      }),
    ]);

    const winRate = totalParticipations > 0 ? (totalWins / totalParticipations) * 100 : 0;

    return {
      totalParticipations,
      totalWins,
      totalRounds,
      winRate: Math.round(winRate * 100) / 100,
      avgDistance: avgDistance._avg.distance ? 
        Math.round((avgDistance._avg.distance || 0) * 100) / 100 : 0,
    };
  }

  async getCommunityLeaderboard(limit: number = 50) {
    // Get win statistics for all users
    const winStats = await db.communitySeed.groupBy({
      by: ['userId'],
      where: { won: true },
      _count: { won: true },
      orderBy: {
        _count: { won: 'desc' },
      },
      take: limit,
    });

    // Get full user details
    const leaderboard = await Promise.all(
      winStats.map(async (stat: { userId: string; _count: { won: number } }, index: number) => {
        const user = await db.user.findUnique({
          where: { id: stat.userId },
          select: {
            id: true,
            walletAddress: true,
          },
        });

        const totalParticipations = await db.communitySeed.count({
          where: { userId: stat.userId },
        });

        const winRate = totalParticipations > 0 ? (stat._count.won / totalParticipations) * 100 : 0;

        return {
          rank: index + 1,
          user: user!,
          totalWins: stat._count.won,
          totalParticipations,
          winRate: Math.round(winRate * 100) / 100,
        };
      })
    );

    return leaderboard;
  }

  async getCachedCommunityRound(roundId: string) {
    const cached = await redis.hgetall(redisKeys.communityRound(roundId));
    
    if (Object.keys(cached).length > 0) {
      const participants = Object.entries(cached).map(([userId, data]) => ({
        userId,
        ...JSON.parse(data),
      }));

      return { participants };
    }

    const participants = await this.getCommunityRoundParticipants(roundId);
    
    // Cache for TTL period
    const cacheData: any = {};
    participants.participants.forEach((p: any) => {
      cacheData[p.userId] = JSON.stringify({
        byte: p.byte,
        joinedAt: p.createdAt,
      });
    });
    
    await redis.hmset(redisKeys.communityRound(roundId), cacheData);

    return participants;
  }
}

const redisKeys = {
  communityRound: (roundId: string) => `community:${roundId}`,
  communityCount: (roundId: string) => `community:${roundId}:count`,
};
