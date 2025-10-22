import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Idl, Program } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

function createReadonlyWallet(): any {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
    payer: kp,
  };
}

export type Outcome =
  | { Numeric: { value: number } }
  | { Shape: { shape: number; color: number; size: number } }
  | { Pattern: { pattern_id: number; matched_value: number } }
  | { Entropy: { tee_score: number; chain_score: number; sensor_score: number; winner: number } }
  | { Community: { final_byte: number; seed_hash: string } };

export async function fetchRoundOutcome(
  idlPath: string,
  programId: PublicKey,
  connection: Connection,
  roundPda: PublicKey,
): Promise<Outcome | null> {
  const idlAbs = path.isAbsolute(idlPath) ? idlPath : path.join(process.cwd(), idlPath);
  const idl = JSON.parse(fs.readFileSync(idlAbs, 'utf8')) as Idl;
  const provider = new AnchorProvider(connection, createReadonlyWallet(), { commitment: 'confirmed' });
  const program: any = new Program(idl as any, programId, provider as any);
  try {
    const accClient = program.account && program.account.round;
    if (!accClient) return null;
    const acc: any = await accClient.fetch(roundPda);
    return acc.outcome as Outcome;
  } catch (_e) {
    return null;
  }
}

export type RoundState = {
  commitmentHash: string | null;
  inputsHash: string | null;
  outcome: Outcome | null;
};

function bytesToHex(bytes: number[] | Uint8Array | null | undefined): string | null {
  if (!bytes) return null;
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return Buffer.from(arr).toString('hex');
}

export async function fetchRoundState(
  idlPath: string,
  programId: PublicKey,
  connection: Connection,
  roundPda: PublicKey,
): Promise<RoundState | null> {
  const idlAbs = path.isAbsolute(idlPath) ? idlPath : path.join(process.cwd(), idlPath);
  const idl = JSON.parse(fs.readFileSync(idlAbs, 'utf8')) as Idl;
  const provider = new AnchorProvider(connection, createReadonlyWallet(), { commitment: 'confirmed' });
  const program: any = new Program(idl as any, programId, provider as any);
  try {
    const accClient = program.account && program.account.round;
    if (!accClient) return null;
    const acc: any = await accClient.fetch(roundPda);
    const commitmentHash = Array.isArray(acc.commitmentHash) ? bytesToHex(acc.commitmentHash) : null;
    const inputsHash = bytesToHex(acc.inputsHash);
    const outcome = (acc.outcome ?? null) as Outcome | null;
    return { commitmentHash, inputsHash, outcome };
  } catch (_e) {
    return null;
  }
}

export async function fetchRoundStateRaw(
  connection: Connection,
  roundPda: PublicKey,
): Promise<RoundState | null> {
  try {
    const info = await connection.getAccountInfo(roundPda);
    if (!info) return null;
    const buf = info.data;
    let o = 0;
    // Anchor 8-byte discriminator
    o += 8;
    // market: Pubkey (32)
    o += 32;
    // number: u64 (8)
    o += 8;
    // status: u8 (1)
    o += 1;
    // inputs_hash: [u8;32]
    const inputsHash = Buffer.from(buf.subarray(o, o + 32)).toString('hex');
    o += 32;
    // outcome enum
    const variant = buf.readUInt8(o); o += 1;
    let outcome: Outcome | null = null;
    switch (variant) {
      case 0: // Pending
        outcome = null;
        break;
      case 1: // Numeric { value: u16 }
        outcome = { Numeric: { value: buf.readUInt16LE(o) } };
        o += 2;
        break;
      case 2: // Shape { shape, color, size }
        outcome = { Shape: { shape: buf.readUInt8(o), color: buf.readUInt8(o + 1), size: buf.readUInt8(o + 2) } };
        o += 3;
        break;
      case 3: // Pattern { pattern_id: u8, matched_value: u16 }
        outcome = { Pattern: { pattern_id: buf.readUInt8(o), matched_value: buf.readUInt16LE(o + 1) } };
        o += 3;
        break;
      case 4: // Entropy { tee_score: u16, chain_score: u16, sensor_score: u16, winner: u8 }
        outcome = {
          Entropy: {
            tee_score: buf.readUInt16LE(o),
            chain_score: buf.readUInt16LE(o + 2),
            sensor_score: buf.readUInt16LE(o + 4),
            winner: buf.readUInt8(o + 6),
          }
        };
        o += 7;
        break;
      case 5: // Community { final_byte: u8, seed_hash: [u8;32] }
        outcome = { Community: { final_byte: buf.readUInt8(o), seed_hash: Buffer.from(buf.subarray(o + 1, o + 33)).toString('hex') } };
        o += 33;
        break;
      default:
        outcome = null;
    }
    // unsettled_bets: u32
    o += 4;
    // opened_at: i64
    o += 8;
    // lock_scheduled_at: i64
    o += 8;
    // locked_at: i64
    o += 8;
    // commitment_hash: Option<[u8;32]>
    const opt = buf.readUInt8(o); o += 1;
    let commitmentHash: string | null = null;
    if (opt === 1) {
      commitmentHash = Buffer.from(buf.subarray(o, o + 32)).toString('hex');
      o += 32;
    }
    // revealed_at: i64 (skip)
    // o += 8;
    return { commitmentHash, inputsHash, outcome };
  } catch {
    return null;
  }
}
