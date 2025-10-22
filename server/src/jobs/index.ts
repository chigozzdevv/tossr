import { roundLifecycleWorker, betSettlementWorker } from './workers';
import { autoLockRounds } from './schedulers';
import { logger } from '@/utils/logger';

let autoLockInterval: NodeJS.Timeout | null = null;

export async function initializeJobs() {
  logger.info('Initializing background jobs...');

  // Workers are already started when imported
  logger.info('Round lifecycle worker started');
  logger.info('Bet settlement worker started');

  autoLockInterval = setInterval(autoLockRounds, 2000);
  logger.info('Auto-lock scheduler started (interval: 2s)');

  logger.info('All background jobs initialized');
}

export async function shutdownJobs() {
  logger.info('Shutting down background jobs...');

  if (autoLockInterval) {
    clearInterval(autoLockInterval);
    autoLockInterval = null;
  }

  await Promise.all([
    roundLifecycleWorker.close(),
    betSettlementWorker.close(),
  ]);

  logger.info('All background jobs shut down');
}
