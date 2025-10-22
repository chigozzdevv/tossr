import { db } from '@/config/database';
import { redis } from '@/config/redis';
import { StreakStatus, MarketType } from '@/shared/types';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';

export class StreaksService {
  async createStreak(userId: string, marketId?: string, target?: number) {
    const streakTarget = target || Math.min(3, config.MAX_STREAK_TARGET);
    
    const existingStreak = await db.streak.findFirst({
      where: {
        userId,
        marketId: marketId || null,
        status: StreakStatus.ACTIVE,
      },
    });

    if (existingStreak) {
      throw new ConflictError('User already has an active streak');
    }

    const streak = await db.streak.create({
      data: {
        userId,
        marketId,
        target: streakTarget,
        status: StreakStatus.ACTIVE,
      },
    });

    // Cache active streak
    await redis.hset(
      redisKeys.activeStreaks,
      `${userId}-${marketId || 'global'}`,
      JSON.stringify(streak)
    );

    logger.info(`Streak created: ${streak.id} - User: ${userId} - Target: ${streakTarget}`);

    return streak;
  }

  async updateStreakProgress(userId: string, roundResult: 'won' | 'lost', roundId: string) {
    const activeStreaks = await db.streak.findMany({
      where: {
        userId,
        status: StreakStatus.ACTIVE,
      },
    });

    const updatedStreaks = [];

    for (const streak of activeStreaks) {
      if (roundResult === 'won') {
        // Increment streak
        const newStreakCount = streak.currentStreak + 1;
        
        if (newStreakCount >= streak.target) {
          // Streak completed!
          const completedStreak = await db.streak.update({
            where: { id: streak.id },
            data: {
              currentStreak: newStreakCount,
              status: StreakStatus.COMPLETED,
              completedAt: new Date(),
              lastRoundId: roundId,
            },
          });
          
          updatedStreaks.push({ ...completedStreak, result: 'completed' });
          
          logger.info(`Streak completed: ${streak.id} - User: ${userId} - Final count: ${newStreakCount}`);
        } else {
          // Continue streak
          const updatedStreak = await db.streak.update({
            where: { id: streak.id },
            data: {
              currentStreak: newStreakCount,
              lastRoundId: roundId,
            },
          });
          
          updatedStreaks.push({ ...updatedStreak, result: 'progress' });
        }
      } else {
        // Reset streaks (lost)
        const resetStreak = await db.streak.update({
          where: { id: streak.id },
          data: {
            status: StreakStatus.FAILED,
            lastRoundId: roundId,
          },
        });
        
        updatedStreaks.push({ ...resetStreak, result: 'failed' });
        
        logger.info(`Streak failed: ${streak.id} - User: ${userId} - Final count: ${streak.currentStreak}`);
      }

      // Update cache
      await redis.hdel(redisKeys.activeStreaks, `${userId}-${streak.marketId || 'global'}`);
    }

    return updatedStreaks;
  }

  async getUserStreaks(userId: string, status?: StreakStatus) {
    const where: any = { userId };
    if (status) where.status = status;

    const streaks = await db.streak.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    return streaks;
  }

  async getActiveStreak(userId: string, marketId?: string) {
    const streak = await db.streak.findFirst({
      where: {
        userId,
        marketId: marketId || null,
        status: StreakStatus.ACTIVE,
      },
    });

    if (!streak) {
      throw new NotFoundError('Active streak');
    }

    return streak;
  }

  async getStreakLeaderboard(limit: number = 50) {
    const topStreaks = await db.streak.findMany({
      where: {
        status: StreakStatus.COMPLETED,
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
      orderBy: [
        { target: 'desc' },
        { completedAt: 'desc' },
      ],
      take: limit,
    });

    return topStreaks.map((streak: any, index: number) => ({
      ...streak,
      rank: index + 1,
      completionTime: streak.completedAt 
        ? new Date(streak.completedAt).getTime() - new Date(streak.startedAt).getTime()
        : 0,
    }));
  }

  async getStreakOdds(target: number): Promise<number> {
    // Calculate odds based on target difficulty
    const baseOdds = 2.0;
    const difficultyMultiplier = Math.pow(target, 1.5);
    
    return Math.min(baseOdds * difficultyMultiplier, 100); // Cap at 100x
  }

  async validateStreakBet(userId: string, target: number, stake: number): Promise<boolean> {
    // Check if user already has active streak
    const existingStreak = await db.streak.findFirst({
      where: {
        userId,
        status: StreakStatus.ACTIVE,
      },
    });

    if (existingStreak) {
      throw new ConflictError('User already has an active streak');
    }

    // Validate target
    if (target < 2 || target > config.MAX_STREAK_TARGET) {
      throw new ValidationError(`Streak target must be between 2 and ${config.MAX_STREAK_TARGET}`);
    }

    // Validate stake
    if (stake <= 0 || stake > 1000000) { // Max 1 SOL
      throw new ValidationError('Invalid stake amount');
    }

    return true;
  }

  async getStreakStats(userId?: string) {
    const where: any = {};
    if (userId) where.userId = userId;

    const [
      totalStreaks,
      completedStreaks,
      failedStreaks,
      activeStreaks,
      bestStreak,
    ] = await Promise.all([
      db.streak.count({ where }),
      db.streak.count({ where: { ...where, status: StreakStatus.COMPLETED } }),
      db.streak.count({ where: { ...where, status: StreakStatus.FAILED } }),
      db.streak.count({ where: { ...where, status: StreakStatus.ACTIVE } }),
      db.streak.findFirst({
        where: { ...where, status: StreakStatus.COMPLETED },
        orderBy: { target: 'desc' },
      }),
    ]);

    const completionRate = totalStreaks > 0 ? (completedStreaks / totalStreaks) * 100 : 0;

    return {
      totalStreaks,
      completedStreaks,
      failedStreaks,
      activeStreaks,
      completionRate: Math.round(completionRate * 100) / 100,
      bestTarget: bestStreak?.target || 0,
      bestCurrentStreak: bestStreak?.currentStreak || 0,
    };
  }

  async cleanupInactiveStreaks() {
    // This would be called by a background job
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 24); // 24 hours ago

    const inactiveStreaks = await db.streak.updateMany({
      where: {
        status: StreakStatus.ACTIVE,
        startedAt: { lt: cutoffTime },
      },
      data: {
        status: StreakStatus.FAILED,
      },
    });

    logger.info(`Cleaned up ${inactiveStreaks.count} inactive streaks`);

    return inactiveStreaks;
  }
}

const redisKeys = {
  activeStreaks: 'streaks:active',
};
