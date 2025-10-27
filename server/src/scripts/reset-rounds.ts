import { RoundsService } from '@/features/rounds/rounds.service';
import { logger } from '@/utils/logger';
import mongoose from 'mongoose';
import { config } from '@/config/env';
import { Round } from '@/features/rounds/rounds.model';
import { Market } from '@/features/markets/markets.model';

const roundsService = new RoundsService();

async function resetRounds() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Delete all rounds
    const deleteResult = await Round.deleteMany({});
    logger.info({ deletedCount: deleteResult.deletedCount }, 'Deleted all rounds');

    // Find an active market
    const market = await Market.findOne({ isActive: true });
    if (!market) {
      throw new Error('No active market found');
    }
    logger.info({ marketId: market._id, marketName: market.name }, 'Found active market');

    // Create and open a new round
    logger.info('Opening new round...');
    const openedRound = await roundsService.openRound(market._id.toString());
    logger.info({ roundId: openedRound._id, roundNumber: openedRound.roundNumber, status: openedRound.status }, 'Round opened');

  } catch (error) {
    logger.error({ error }, 'Reset failed');
    console.error(error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

resetRounds();
