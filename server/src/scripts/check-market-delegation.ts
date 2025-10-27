import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

async function checkMarketDelegation() {
  try {
    const erConnection = new Connection(config.EPHEMERAL_RPC_URL);
    const baseConnection = new Connection(config.SOLANA_RPC_URL);

    const marketPubkey = new PublicKey('vPyX5xEjcFhyQyLbt7X7rN2rJWyVhVaU1mTmtZa5oVM');

    logger.info('Checking market account delegation status');

    const erAccount = await erConnection.getAccountInfo(marketPubkey);
    const baseAccount = await baseConnection.getAccountInfo(marketPubkey);

    logger.info({
      erExists: !!erAccount,
      erOwner: erAccount?.owner.toString(),
      baseExists: !!baseAccount,
      baseOwner: baseAccount?.owner.toString()
    }, 'Market delegation status');

  } catch (error) {
    logger.error({ error }, 'Check failed');
    console.error(error);
  } finally {
    process.exit(0);
  }
}

checkMarketDelegation();
