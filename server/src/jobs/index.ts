import { roundLifecycleWorker, betSettlementWorker } from './workers';
import { autoLockRounds, autoOpenRounds } from './schedulers';
import { logger } from '@/utils/logger';

let autoLockInterval: NodeJS.Timeout | null = null;
let autoOpenInterval: NodeJS.Timeout | null = null;

export async function initializeJobs() {
  logger.info('Initializing background jobs...');

  // Workers are already started when imported
  logger.info('Round lifecycle worker started');
  logger.info('Bet settlement worker started');

  autoOpenInterval = setInterval(autoOpenRounds, 10000);
  autoLockInterval = setInterval(autoLockRounds, 2000);
  logger.info('Auto-open scheduler started (interval: 3s)');
  logger.info('Auto-lock scheduler started (interval: 2s)');

  logger.info('All background jobs initialized');
}

export async function shutdownJobs() {
  logger.info('Shutting down background jobs...');

  if (autoLockInterval) {
    clearInterval(autoLockInterval);
    autoLockInterval = null;
  }
  if (autoOpenInterval) {
    clearInterval(autoOpenInterval);
    autoOpenInterval = null;
  }

  await Promise.all([
    roundLifecycleWorker.close(),
    betSettlementWorker.close(),
  ]);

  logger.info('All background jobs shut down');
}
