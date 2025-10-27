import { RoundsService } from '@/features/rounds/rounds.service';
import { logger } from '@/utils/logger';
import mongoose from 'mongoose';
import { config } from '@/config/env';

const roundsService = new RoundsService();

async function testLock() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.info('Connected to MongoDB');

    const roundId = '68ffac8f6bcefb66a799aecd';
    logger.info({ roundId }, 'Attempting to lock round...');

    const result = await roundsService.lockRound(roundId);
    logger.info({ roundId, result }, 'Round locked successfully');
  } catch (error) {
    logger.error({ error }, 'Lock failed');
    console.error(error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

testLock();
