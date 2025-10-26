import { roundLifecycleWorker, betSettlementWorker } from './workers';
import { autoLockRounds, autoOpenRounds, releaseQueuedRounds, cleanupOldRounds } from './schedulers';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

let autoLockInterval: NodeJS.Timeout | null = null;
let autoOpenInterval: NodeJS.Timeout | null = null;
let releaseInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

export async function initializeJobs() {
  logger.info('Initializing background jobs...');

  // Workers are already started when imported
  logger.info('Round lifecycle worker started');
  logger.info('Bet settlement worker started');

  await autoOpenRounds();
  await releaseQueuedRounds();

  autoOpenInterval = setInterval(autoOpenRounds, config.ROUND_RELEASE_INTERVAL_SECONDS * 1000);
  autoLockInterval = setInterval(autoLockRounds, 15000);
  releaseInterval = setInterval(releaseQueuedRounds, config.ROUND_RELEASE_POLL_SECONDS * 1000);
  cleanupInterval = setInterval(cleanupOldRounds, 60 * 60 * 1000);
  logger.info({ intervalSeconds: config.ROUND_RELEASE_INTERVAL_SECONDS }, 'Auto-open scheduler started');
  logger.info('Auto-lock scheduler started (interval: 15s)');
  logger.info({ intervalSeconds: config.ROUND_RELEASE_POLL_SECONDS }, 'Release queued scheduler started');
  logger.info('Cleanup old rounds scheduler started (interval: 1h)');

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
  if (releaseInterval) {
    clearInterval(releaseInterval);
    releaseInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  await Promise.all([
    roundLifecycleWorker.close(),
    betSettlementWorker.close(),
  ]);

  logger.info('All background jobs shut down');
}
