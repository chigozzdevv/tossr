import { db } from '@/config/database';
import { generateJWT, verifySolanaMessage } from '@/utils/auth';
import { AuthenticationError } from '@/shared/errors';
import { logger } from '@/utils/logger';
import { randomBytes } from 'crypto';

export class AuthService {
  async signInWithWallet(message: string, signature: string, publicKey: string) {
    const isValidSignature = await verifySolanaMessage(message, signature, publicKey);

    if (!isValidSignature) {
      throw new AuthenticationError('Invalid signature');
    }

    const nonce = `tosr-auth-${randomBytes(4).toString('hex')}`;
    if (!message.includes(nonce) && !message.includes('tosr-auth')) {
      throw new AuthenticationError('Invalid auth message format');
    }

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
