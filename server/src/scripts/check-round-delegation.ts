import { Round } from '@/config/database';
import { logger } from '@/utils/logger';
import mongoose from 'mongoose';
import { config } from '@/config/env';
import { Connection, PublicKey } from '@solana/web3.js';

async function checkDelegation() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.info('Connected to MongoDB');

    const roundId = '68fee6ec3d0b0a81d8733c3a';
    const round = await Round.findById(roundId).lean();

    if (!round) {
      logger.error('Round not found');
      return;
    }

    logger.info({
      roundNumber: round.roundNumber,
      delegateTxHash: (round as any).delegateTxHash,
      undelegateTxHash: (round as any).undelegateTxHash,
      solanaAddress: (round as any).solanaAddress
    }, 'Round delegation status in DB');

    const roundPda = new PublicKey((round as any).solanaAddress);
    const baseConn = new Connection(config.SOLANA_RPC_URL);
    const erConn = new Connection(config.EPHEMERAL_RPC_URL);

    const [baseAccount, erAccount] = await Promise.all([
      baseConn.getAccountInfo(roundPda),
      erConn.getAccountInfo(roundPda)
    ]);

    logger.info({
      baseAccount: baseAccount ? {
        owner: baseAccount.owner.toString(),
        dataLength: baseAccount.data.length
      } : null,
      erAccount: erAccount ? {
        owner: erAccount.owner.toString(),
        dataLength: erAccount.data.length
      } : null
    }, 'Round account on-chain status');

    const TOSSR_PROGRAM_ID = config.TOSSR_ENGINE_PROGRAM_ID;
    const DELEGATION_PROGRAM_ID = config.DELEGATION_PROGRAM_ID;

    if (baseAccount && baseAccount.owner.toString() === TOSSR_PROGRAM_ID) {
      logger.info('Round is on BASE layer (owned by Tossr program)');
    } else if (baseAccount && baseAccount.owner.toString() === DELEGATION_PROGRAM_ID) {
      logger.info('Round is DELEGATED to ER (owned by Delegation program)');
    } else {
      logger.warn('Round has unexpected owner or does not exist');
    }

  } catch (error) {
    logger.error({ error }, 'Check failed');
    console.error(error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkDelegation();
