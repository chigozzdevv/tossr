import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'crypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { config } from '@/config/env';

export enum MarketType {
  PICK_RANGE = 'PickRange',
  EVEN_ODD = 'EvenOdd',
  LAST_DIGIT = 'LastDigit',
  MODULO_THREE = 'ModuloThree',
  PATTERN_OF_DAY = 'PatternOfDay',
  SHAPE_COLOR = 'ShapeColor',
  JACKPOT = 'Jackpot',
  ENTROPY_BATTLE = 'EntropyBattle',
  STREAK_METER = 'StreakMeter',
  COMMUNITY_SEED = 'CommunitySeed',
}

export interface OutcomeType {
  Numeric?: { value: number };
  Shape?: { shape: number; color: number; size: number };
  Pattern?: { pattern_id: number; matched_value: number };
  Entropy?: { tee_score: number; chain_score: number; sensor_score: number; winner: number };
  Community?: { final_byte: number; seed_hash: string };
}

export interface TeeAttestation {
  round_id: string;
  market_type: string;
  outcome: OutcomeType;
  commitment_hash: string;
  nonce: string;
  inputs_hash: string;
  code_measurement: string;
  signature: string;
  public_key: string;
  timestamp: number;
}

const DEV_DEFAULT_TEE_KEY_HEX = '62bb8ebe78f681f2c6c7c30c9d2625b0cf243e6400f5a3976ad57132a6360621';
const EFFECTIVE_TEE_KEY_HEX = config.TEE_PRIVATE_KEY_HEX || (config.NODE_ENV === 'development' ? DEV_DEFAULT_TEE_KEY_HEX : '');
const TEE_PRIVATE_KEY_BYTES: Uint8Array | null = EFFECTIVE_TEE_KEY_HEX ? hexToBytes(EFFECTIVE_TEE_KEY_HEX) : null;
const TEE_PUBLIC_KEY: Uint8Array | null = TEE_PRIVATE_KEY_BYTES ? secp256k1.getPublicKey(TEE_PRIVATE_KEY_BYTES, false) : null;

export class TeeEngine {
  private streakState: Map<string, number> = new Map();

  getPublicKeyBytes(): Uint8Array {
    return TEE_PUBLIC_KEY ?? new Uint8Array();
  }

  generateOutcome(
    roundId: string,
    marketType: MarketType,
    params: { chainHash?: number[]; communitySeeds?: number[] } = {}
  ): TeeAttestation {
    let outcome: OutcomeType;

    switch (marketType) {
      case MarketType.PICK_RANGE:
        outcome = this.generateRangeOutcome();
        break;
      case MarketType.EVEN_ODD:
        outcome = this.generateEvenOddOutcome();
        break;
      case MarketType.LAST_DIGIT:
        outcome = this.generateLastDigitOutcome();
        break;
      case MarketType.MODULO_THREE:
        outcome = this.generateModuloOutcome();
        break;
      case MarketType.PATTERN_OF_DAY:
        outcome = this.generatePatternOutcome();
        break;
      case MarketType.SHAPE_COLOR:
        outcome = this.generateShapeOutcome();
        break;
      case MarketType.JACKPOT:
        outcome = this.generateJackpotOutcome();
        break;
      case MarketType.ENTROPY_BATTLE:
        outcome = this.generateEntropyOutcome(params.chainHash);
        break;
      case MarketType.COMMUNITY_SEED:
        outcome = this.generateCommunityOutcome(params.communitySeeds || []);
        break;
      default:
        outcome = this.generateRangeOutcome();
    }

    return this.createAttestation(roundId, marketType, outcome);
  }

  private generateRangeOutcome(): OutcomeType {
    const value = (this.randomU32() % 100) + 1;
    return { Numeric: { value } };
  }

  private generateEvenOddOutcome(): OutcomeType {
    const value = this.randomU32() % 2;
    return { Numeric: { value } };
  }

  private generateLastDigitOutcome(): OutcomeType {
    const value = this.randomU32() % 10;
    return { Numeric: { value } };
  }

  private generateModuloOutcome(): OutcomeType {
    const value = this.randomU32() % 3;
    return { Numeric: { value } };
  }

  private generatePatternOutcome(): OutcomeType {
    const value = this.randomU32() % 1000;
    let pattern_id: number;
    if (this.isPrime(value)) pattern_id = 0;
    else if (this.isFibonacci(value)) pattern_id = 1;
    else if (this.isPerfectSquare(value)) pattern_id = 2;
    else if (value % 10 === 7) pattern_id = 3;
    else if (this.isPalindrome(value)) pattern_id = 4;
    else if (value % 2 === 0) pattern_id = 5;
    else pattern_id = 6;
    return { Pattern: { pattern_id, matched_value: value } };
  }

  private generateShapeOutcome(): OutcomeType {
    const shape = this.randomU32() % 4;
    const color = this.randomU32() % 6;
    const size = this.randomU32() % 3;
    return { Shape: { shape, color, size } };
  }

  private generateJackpotOutcome(): OutcomeType {
    const value = this.randomU32() % 100;
    return { Numeric: { value } };
  }

  private generateEntropyOutcome(chainHash?: number[]): OutcomeType {
    const teeBytes = randomBytes(32);
    const tee_score = this.calculateEntropyScore(teeBytes);
    const chain_bytes = chainHash ? new Uint8Array(chainHash) : new Uint8Array(32);
    const chain_score = this.calculateEntropyScore(chain_bytes);
    const sensor_bytes = randomBytes(32);
    const sensor_score = this.calculateEntropyScore(sensor_bytes);
    const winner = tee_score >= chain_score && tee_score >= sensor_score ? 0 : chain_score >= tee_score && chain_score >= sensor_score ? 1 : 2;
    return { Entropy: { tee_score, chain_score, sensor_score, winner } };
  }

  private generateCommunityOutcome(seeds: number[]): OutcomeType {
    if (seeds.length === 0) {
      return { Community: { final_byte: 0, seed_hash: bytesToHex(new Uint8Array(32)) } };
    }
    const seed_hash = sha256(new Uint8Array(seeds));
    const final_byte = seed_hash[31] || 0;
    return { Community: { final_byte, seed_hash: bytesToHex(seed_hash) } };
  }

  updateStreak(wallet: string, won: boolean): number {
    const current = this.streakState.get(wallet) || 0;
    const newStreak = won ? current + 1 : 0;
    this.streakState.set(wallet, newStreak);
    return newStreak;
  }

  getStreak(wallet: string): number {
    return this.streakState.get(wallet) || 0;
  }

  private createAttestation(roundId: string, marketType: string, outcome: OutcomeType): TeeAttestation {
    const nonce = randomBytes(32);
    const outcomeBytes = this.encodeOutcome(outcome);
    const commitment_hash = sha256(Buffer.concat([outcomeBytes, nonce]));

    const inputs = JSON.stringify({ roundId, marketType, outcome });
    const inputs_hash = sha256(Buffer.from(inputs));
    const code_measurement = sha256(Buffer.from('tossr-tee-engine-0.1.0'));

    if (!TEE_PRIVATE_KEY_BYTES) {
      throw new Error('TEE signing key not configured. Set TEE_PRIVATE_KEY_HEX (prod) or run in development for the default.');
    }
    if (!TEE_PUBLIC_KEY) {
      throw new Error('TEE public key not available. Ensure TEE_PRIVATE_KEY_HEX is set and valid.');
    }
    const signatureBytes = secp256k1.sign(commitment_hash, TEE_PRIVATE_KEY_BYTES);
    const timestamp = Math.floor(Date.now() / 1000);

    return {
      round_id: roundId,
      market_type: marketType,
      outcome,
      commitment_hash: bytesToHex(commitment_hash),
      nonce: bytesToHex(nonce),
      inputs_hash: bytesToHex(inputs_hash),
      code_measurement: bytesToHex(code_measurement),
      signature: bytesToHex(signatureBytes),
      public_key: bytesToHex(TEE_PUBLIC_KEY!),
      timestamp,
    };
  }

  private encodeOutcome(outcome: OutcomeType): Buffer {
    if (outcome.Numeric) {
      const buf = Buffer.alloc(2);
      buf.writeUInt16LE(outcome.Numeric.value);
      return buf;
    }
    if (outcome.Shape) {
      const buf = Buffer.alloc(3);
      buf.writeUInt8(outcome.Shape.shape, 0);
      buf.writeUInt8(outcome.Shape.color, 1);
      buf.writeUInt8(outcome.Shape.size, 2);
      return buf;
    }
    if (outcome.Pattern) {
      const buf = Buffer.alloc(4);
      buf.writeUInt16LE(outcome.Pattern.pattern_id, 0);
      buf.writeUInt16LE(outcome.Pattern.matched_value, 2);
      return buf;
    }
    if (outcome.Entropy) {
      const buf = Buffer.alloc(13);
      buf.writeUInt32LE(outcome.Entropy.tee_score, 0);
      buf.writeUInt32LE(outcome.Entropy.chain_score, 4);
      buf.writeUInt32LE(outcome.Entropy.sensor_score, 8);
      buf.writeUInt8(outcome.Entropy.winner, 12);
      return buf;
    }
    if (outcome.Community) {
      const buf = Buffer.alloc(33);
      buf.writeUInt8(outcome.Community.final_byte, 0);
      Buffer.from(outcome.Community.seed_hash, 'hex').copy(buf, 1);
      return buf;
    }
    return Buffer.alloc(2);
  }

  private randomU32(): number {
    return randomBytes(4).readUInt32LE(0);
  }

  private calculateEntropyScore(bytes: Uint8Array): number {
    const freq = new Array(256).fill(0);
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte !== undefined) {
        freq[byte]++;
      }
    }
    const len = bytes.length;
    let entropy = 0.0;
    for (const count of freq) {
      if (count > 0) {
        const p = count / len;
        entropy -= p * Math.log2(p);
      }
    }
    return Math.floor(entropy * 125);
  }

  private isPrime(n: number): boolean {
    if (n < 2) return false;
    if (n === 2) return true;
    if (n % 2 === 0) return false;
    const sqrt = Math.floor(Math.sqrt(n));
    for (let i = 3; i <= sqrt; i += 2) {
      if (n % i === 0) return false;
    }
    return true;
  }

  private isFibonacci(n: number): boolean {
    const fibs = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];
    return fibs.includes(n);
  }

  private isPerfectSquare(n: number): boolean {
    const sqrt = Math.sqrt(n);
    return sqrt === Math.floor(sqrt);
  }

  private isPalindrome(n: number): boolean {
    const s = n.toString();
    return s === s.split('').reverse().join('');
  }
}
