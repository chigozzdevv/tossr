import { db } from '@/config/database';
import { generateJWT, verifySolanaMessage } from '@/utils/auth';
import { AuthenticationError } from '@/shared/errors';
import { logger } from '@/utils/logger';
import { randomBytes } from 'crypto';
import { redis, redisKeys } from '@/config/redis';

export class AuthService {
  async createNonce(publicKey: string) {
    if (!publicKey) {
      throw new AuthenticationError('Missing publicKey');
    }
    const nonce = randomBytes(16).toString('hex');
    await redis.set(redisKeys.authNonce(publicKey), nonce, 'EX', 300);
    return { nonce, message: `tosr-auth:${nonce}` };
  }
  async signInWithWallet(message: string, signature: string, publicKey: string) {
    const isValidSignature = await verifySolanaMessage(message, signature, publicKey);
    if (!isValidSignature) {
      throw new AuthenticationError('Invalid signature');
    }
    const stored = await redis.get(redisKeys.authNonce(publicKey));
    if (!stored) {
      throw new AuthenticationError('Auth nonce expired');
    }
    const expected = `tosr-auth:${stored}`;
    if (message !== expected) {
      throw new AuthenticationError('Invalid auth message');
    }
    await redis.del(redisKeys.authNonce(publicKey));

    // Find or create user
    let user = await db.user.findUnique({
      where: { walletAddress: publicKey },
    });

    if (!user) {
      user = await db.user.create({
        data: {
          walletAddress: publicKey,
        },
      });

      logger.info(`New user created: ${publicKey}`);
    }

    // Generate JWT
    const token = generateJWT(user.id, user.walletAddress);

    return {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
      },
      token,
    };
  }

  async refreshSession(userId: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    const token = generateJWT(user.id, user.walletAddress);

    return {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
      },
      token,
    };
  }
}
