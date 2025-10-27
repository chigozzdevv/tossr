import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

async function testERConnectivity() {
  try {
    const erConnection = new Connection(config.EPHEMERAL_RPC_URL);
    const baseConnection = new Connection(config.SOLANA_RPC_URL);

    logger.info({ erUrl: config.EPHEMERAL_RPC_URL }, 'Testing ER connectivity');

    // Test basic connectivity
    const erBlockhash = await erConnection.getLatestBlockhash();
    logger.info({ blockhash: erBlockhash.blockhash }, 'ER blockhash fetched successfully');

    // Test account fetch
    const roundPda = new PublicKey('G7YPY9pHnW1QT5CLoP87yku3N25EMgzX4HeDeCTqVSFt');

    logger.info('Fetching round account from ER...');
    const erAccount = await erConnection.getAccountInfo(roundPda);
    logger.info({
      exists: !!erAccount,
      owner: erAccount?.owner.toString(),
      lamports: erAccount?.lamports
    }, 'ER account info');

    logger.info('Fetching round account from base layer...');
    const baseAccount = await baseConnection.getAccountInfo(roundPda);
    logger.info({
      exists: !!baseAccount,
      owner: baseAccount?.owner.toString(),
      lamports: baseAccount?.lamports
    }, 'Base layer account info');

  } catch (error) {
    logger.error({ error }, 'ER connectivity test failed');
    console.error(error);
  } finally {
    process.exit(0);
  }
}

testERConnectivity();
