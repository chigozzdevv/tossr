import { Connection } from '@solana/web3.js';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

async function testMagicRouter() {
  const erConn = new Connection(config.EPHEMERAL_RPC_URL);
  const baseConn = new Connection(config.SOLANA_RPC_URL);

  logger.info({ url: config.EPHEMERAL_RPC_URL }, 'Testing Magic Router');
  logger.info({ url: config.SOLANA_RPC_URL }, 'Testing Base RPC');

  try {
    const erBlockhash = await erConn.getLatestBlockhash();
    logger.info({ blockhash: erBlockhash.blockhash, lastValidBlockHeight: erBlockhash.lastValidBlockHeight }, 'Magic Router blockhash SUCCESS');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Magic Router blockhash FAILED');
  }

  try {
    const baseBlockhash = await baseConn.getLatestBlockhash();
    logger.info({ blockhash: baseBlockhash.blockhash, lastValidBlockHeight: baseBlockhash.lastValidBlockHeight }, 'Base RPC blockhash SUCCESS');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Base RPC blockhash FAILED');
  }

  process.exit(0);
}

testMagicRouter();
