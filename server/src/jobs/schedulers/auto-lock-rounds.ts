import { db } from '@/config/database';
import { RoundStatus } from '@/shared/types';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { roundLifecycleQueue } from '../queues';

export async function autoLockRounds() {
  try {
    const now = new Date();
    const lockThreshold = new Date(now.getTime() - config.ROUND_DURATION_SECONDS * 1000);

    const roundsToLock = await db.round.findMany({
      where: {
        status: RoundStatus.PREDICTING,
        openedAt: {
          lte: lockThreshold,
        },
      },
    });

    for (const round of roundsToLock) {
      const jobId = `lock-${round.id}`;
      const existingJob = await roundLifecycleQueue.getJob(jobId);

      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          logger.debug({ roundId: round.id, jobState: state }, 'Lock job already pending, skipping');
          continue;
        }
      }

      await roundLifecycleQueue.add('lock-round', { roundId: round.id }, { jobId });
      logger.info({ roundId: round.id }, 'Auto-lock job scheduled');
    }

    if (roundsToLock.length > 0) {
      logger.info({ count: roundsToLock.length }, 'Auto-lock scheduler processed rounds');
    }
  } catch (error) {
    logger.error({ error }, 'Auto-lock scheduler error');
  }
}
