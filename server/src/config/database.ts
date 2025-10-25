import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prismaClient = globalThis.__prisma || new PrismaClient({
  log: ['warn', 'error'],
  errorFormat: 'pretty',
});

if (process.env.NODE_ENV === 'development') {
  globalThis.__prisma = prismaClient;
}

type RetryOptions = {
  retries?: number;
  intervalMs?: number;
};

export async function connectDatabase(options: RetryOptions = {}) {
  const { retries = 5, intervalMs = 1000 } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await prismaClient.$connect();
      if (attempt > 0) {
        logger.info(`[Database] Connected successfully after ${attempt + 1} attempts`);
      } else {
        logger.info('[Database] Connected successfully');
      }
      return;
    } catch (error) {
      const isLastAttempt = attempt === retries;
      logger.warn({ err: error, attempt: attempt + 1 }, 'Database connection attempt failed');
      if (isLastAttempt) {
        logger.fatal({ err: error }, 'Database connection failed');
        throw error;
      }
      const delay = intervalMs * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export const prisma = prismaClient;
export { prisma as db };
