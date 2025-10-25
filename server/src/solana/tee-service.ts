import { Connection, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { mapServerToTeeMarketType } from '@/utils/market-type-mapper';
import { createHash } from 'crypto';
import { getAdminKeypair } from '@/config/admin-keypair';

interface TeeAttestation {
  round_id: string;
  market_type: string;
  outcome: any;
  commitment_hash: string;
  nonce: string;
  inputs_hash: string;
  code_measurement: string;
  signature: string;
  public_key: string;
  timestamp: number;
}

export class TeeService {
  private teeRpcUrl: string;
  private connection: Connection;
  private integrityOkAt?: number;
  private authToken?: string;
  private authTokenExpiresAt?: number;
  private readonly adminKeypair = getAdminKeypair();
  private readonly adminPublicKey = new PublicKey(this.adminKeypair.publicKey);

  constructor() {
    this.teeRpcUrl = (config.TEE_RPC_URL || '').replace(/\/+$/, '');
    this.connection = new Connection(config.SOLANA_RPC_URL);
  }

  private async ensureIntegrity() {
    if (!config.TEE_INTEGRITY_REQUIRED) {
      return;
    }
    const now = Date.now();
    if (this.integrityOkAt && now - this.integrityOkAt < config.ATTESTATION_CACHE_TTL * 1000) {
      return;
    }
    const { verifyTeeRpcIntegrity } = await import('@magicblock-labs/ephemeral-rollups-sdk/lib/privacy/verify.js');
    const ok = await verifyTeeRpcIntegrity(this.teeRpcUrl);
    if (!ok) {
      throw new Error('TEE integrity verification failed');
    }
    this.integrityOkAt = now;
  }

  private decodeExpiry(token: string, fallback: number) {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return fallback;
    }
    try {
      const [, payloadBase64] = parts;
      if (!payloadBase64) {
        return fallback;
      }
      const raw = Buffer.from(payloadBase64, 'base64url').toString('utf8');
      const payload = JSON.parse(raw) as { exp?: number };
      if (payload.exp) {
        return Math.max(Date.now() + 1000, payload.exp * 1000 - 5000);
      }
    } catch {}
    return fallback;
  }

  private async ensureAuthToken(): Promise<string> {
    const ttlMs = config.TEE_AUTH_CACHE_TTL * 1000;
    const now = Date.now();
    if (this.authToken && this.authTokenExpiresAt && now < this.authTokenExpiresAt) {
      return this.authToken;
    }
    const { getAuthToken } = await import('@magicblock-labs/ephemeral-rollups-sdk/lib/privacy/auth.js');
    const token = await getAuthToken(
      this.teeRpcUrl,
      this.adminPublicKey,
      async (message: Uint8Array) => nacl.sign.detached(message, this.adminKeypair.secretKey)
    );
    this.authToken = token;
    this.authTokenExpiresAt = this.decodeExpiry(token, now + ttlMs);
    return token;
  }

  private async buildUrl(path: string, authorize = true): Promise<string> {
    const base = new URL(path, `${this.teeRpcUrl}/`);
    if (authorize) {
      const token = await this.ensureAuthToken();
      base.searchParams.set('token', token);
    }
    return base.toString();
  }

  async generateOutcome(
    roundId: string,
    marketType: string,
    params: {
      chainHash?: Uint8Array;
      communitySeeds?: number[];
      vrfRandomness?: Uint8Array;
    } = {}
  ): Promise<TeeAttestation> {
    try {
      await this.ensureIntegrity();
      const endpoint = await this.buildUrl('/generate_outcome');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const teeMarketType = mapServerToTeeMarketType(marketType as any);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_id: roundId,
          market_type: teeMarketType,
          params: {
            chain_hash: params.chainHash ? Array.from(params.chainHash) : null,
            community_seeds: params.communitySeeds || null,
            vrf_randomness: params.vrfRandomness ? Array.from(params.vrfRandomness) : null,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`TEE RPC HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as TeeAttestation;
    } catch (error: any) {
      logger.error({ err: error }, 'TEE outcome generation failed');
      throw new Error(`TEE RPC error: ${error.message}`);
    }
  }

  async updateStreak(
    roundId: string,
    wallet: string,
    won: boolean,
    target: number
  ): Promise<{ new_streak: number }> {
    try {
      await this.ensureIntegrity();
      const endpoint = await this.buildUrl('/update_streak');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_id: roundId,
          wallet,
          won,
          target,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`TEE RPC HTTP ${response.status}`);
      }

      return (await response.json()) as { new_streak: number };
    } catch (error: any) {
      logger.error({ err: error }, 'TEE streak update failed');
      throw new Error(`TEE RPC error: ${error.message}`);
    }
  }

  async getStreakState(wallet: string): Promise<{ streak: number }> {
    try {
      await this.ensureIntegrity();
      const endpoint = await this.buildUrl(`/get_streak/${wallet}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`TEE RPC HTTP ${response.status}`);
      }

      return (await response.json()) as { streak: number };
    } catch (error: any) {
      logger.error({ err: error }, 'TEE streak fetch failed');
      throw new Error(`TEE RPC error: ${error.message}`);
    }
  }

  async getLatestBlockhash(): Promise<Uint8Array> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    const digest = createHash('sha256').update(blockhash).digest();
    return new Uint8Array(digest.subarray(0, 32));
  }

}
