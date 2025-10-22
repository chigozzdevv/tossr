import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

declare global {
  var __prisma: PrismaClient | undefined;
}

export function connectDatabase() {
  const prisma = globalThis.__prisma || new PrismaClient({
    log: ['warn', 'error'],
    errorFormat: 'pretty',
  });

  if (process.env.NODE_ENV === 'development') {
    globalThis.__prisma = prisma;
  }

  return prisma.$connect()
    .then(() => {
      logger.info('[Database] Connected successfully');
    })
    .catch((error: Error) => {
      logger.fatal({ err: error }, 'Database connection failed');
      throw error;
    });
}

export const prisma = globalThis.__prisma || new PrismaClient({
  log: ['warn', 'error'],
  errorFormat: 'pretty',
});

export { prisma as db };
