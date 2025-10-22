import { Connection } from '@solana/web3.js';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { verifyTeeRpcIntegrity } from '@magicblock-labs/ephemeral-rollups-sdk/privacy';
import { mapServerToTeeMarketType } from '@/utils/market-type-mapper';

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

  constructor() {
    this.teeRpcUrl = config.TEE_RPC_URL;
    this.connection = new Connection(config.SOLANA_RPC_URL);
  }

  async generateOutcome(
    roundId: string,
    marketType: string,
    params: {
      chainHash?: Uint8Array;
      communitySeeds?: number[];
    } = {}
  ): Promise<TeeAttestation> {
    try {
      // Enforce integrity if required
      if (config.TEE_INTEGRITY_REQUIRED) {
        const now = Date.now();
        if (!this.integrityOkAt || now - this.integrityOkAt > 10 * 60 * 1000) {
          const ok = await verifyTeeRpcIntegrity(this.teeRpcUrl);
          if (!ok) {
            throw new Error('TEE integrity verification failed');
          }
          this.integrityOkAt = now;
        }
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const teeMarketType = mapServerToTeeMarketType(marketType as any);

      const response = await fetch(`${this.teeRpcUrl}/generate_outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_id: roundId,
          market_type: teeMarketType,
          params: {
            chain_hash: params.chainHash ? Array.from(params.chainHash) : null,
            community_seeds: params.communitySeeds || null,
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${this.teeRpcUrl}/update_streak`, {
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.teeRpcUrl}/get_streak/${wallet}`, {
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
    const blockhash = await this.connection.getLatestBlockhash();
    const encoder = new TextEncoder();
    const hashBytes = encoder.encode(blockhash.blockhash);
    const hash = new Uint8Array(32);
    hash.set(hashBytes.slice(0, 32));
    return hash;
  }

}
