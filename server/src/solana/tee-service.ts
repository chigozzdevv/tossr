import { Connection } from '@solana/web3.js';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { mapServerToTeeMarketType } from '@/utils/market-type-mapper';
import { createHash, randomBytes } from 'crypto';
import { createRequire } from 'module';
import { readFile } from 'fs/promises';

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
    this.teeRpcUrl = (config.TEE_RPC_URL || '').replace(/\/+$/, '');
    this.connection = new Connection(config.SOLANA_RPC_URL);
  }

  private async verifyTeeRpcIntegrityNode(rpcUrl: string): Promise<boolean> {
    const challengeBytes = randomBytes(32);
    const challenge = challengeBytes.toString('base64');
    const url = `${rpcUrl}/quote?challenge=${encodeURIComponent(challenge)}`;
    const response = await fetch(url);
    const body: unknown = await response.json();
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    if (response.status !== 200) {
      const msg = isObj(body) && typeof body.error === 'string' ? (body.error as string) : `HTTP ${response.status}`;
      throw new Error(msg || 'Failed to get quote');
    }
    if (!isObj(body) || typeof body.quote !== 'string') {
      throw new Error('Invalid quote response');
    }

    const { default: init, js_get_collateral, js_verify } = await import('@phala/dcap-qvl-web');
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('@phala/dcap-qvl-web/dcap-qvl-web_bg.wasm');
    const wasmBytes = await readFile(wasmPath);
    await init(wasmBytes);

    const rawQuote = Uint8Array.from(Buffer.from(body.quote as string, 'base64'));
    const pccsUrl = 'https://pccs.phala.network/tdx/certification/v4';
    const quoteCollateral = await js_get_collateral(pccsUrl, rawQuote);
    const now = BigInt(Math.floor(Date.now() / 1000));
    try {
      js_verify(rawQuote, quoteCollateral, now);
      return true;
    } catch {
      return false;
    }
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
      if (config.TEE_INTEGRITY_REQUIRED) {
        const now = Date.now();
        if (!this.integrityOkAt || now - this.integrityOkAt > 10 * 60 * 1000) {
          const ok = await this.verifyTeeRpcIntegrityNode(this.teeRpcUrl);
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
    const { blockhash } = await this.connection.getLatestBlockhash();
    const digest = createHash('sha256').update(blockhash).digest();
    return new Uint8Array(digest.subarray(0, 32));
  }

}
