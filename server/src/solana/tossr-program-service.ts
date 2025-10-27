import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import {
  MAGIC_CONTEXT_ID as SDK_MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID as SDK_MAGIC_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { DISCRIMINATORS } from '@/utils/anchor-discriminators';
import { BorshCoder, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const TOSSR_PROGRAM_ID = new PublicKey(config.TOSSR_ENGINE_PROGRAM_ID);
const DELEGATION_PROGRAM_PK = new PublicKey(config.DELEGATION_PROGRAM_ID);
const MAGIC_PROGRAM_PK = SDK_MAGIC_PROGRAM_ID as unknown as PublicKey;
const MAGIC_CONTEXT_PK = SDK_MAGIC_CONTEXT_ID as unknown as PublicKey;

const MARKET_SEED = Buffer.from('market');
const ROUND_SEED = Buffer.from('round');
const VAULT_SEED = Buffer.from('vault');
const BET_SEED = Buffer.from('bet');

export class TossrProgramService {
  private connection: Connection;
  private erConnection: Connection;
  private coder: BorshCoder;
  constructor() {
    this.connection = new Connection(config.SOLANA_RPC_URL);
    this.erConnection = new Connection(config.EPHEMERAL_RPC_URL);
    const idlPath = path.resolve(__dirname, '../../../contracts/anchor/target/idl/tossr_engine.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl;
    this.coder = new BorshCoder(idl as any);
  }

  async setHouseEdgeBps(
    marketId: PublicKey,
    houseEdgeBps: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const data = Buffer.concat([
      DISCRIMINATORS.SET_HOUSE_EDGE_BPS,
      Buffer.from(new Uint16Array([houseEdgeBps]).buffer),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const tx = new Transaction().add(ix);
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.connection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
    await this.connection.confirmTransaction(sig);
    return sig;
  }

  async placeBet(
    userPublicKey: PublicKey,
    marketId: PublicKey,
    roundNumber: number,
    selection: { kind: number; a: number; b: number; c: number },
    stakeAmount: number,
    mint: PublicKey,
    opts?: { useER?: boolean }
  ): Promise<{ transaction: Transaction; betPda: PublicKey }> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, marketId.toBuffer()],
      TOSSR_PROGRAM_ID
    );

    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, roundPda.toBuffer(), userPublicKey.toBuffer()],
      TOSSR_PROGRAM_ID
    );

    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      userPublicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      mint,
      vaultPda,
      true
    );

    const placeBetData = (() => {
      const stakeBuf = Buffer.alloc(8);
      stakeBuf.writeBigUInt64LE(BigInt(stakeAmount));
      const selBuf = Buffer.alloc(1 + 2 + 2 + 2);
      selBuf.writeUInt8(selection.kind & 0xff, 0);
      selBuf.writeUInt16LE(selection.a & 0xffff, 1);
      selBuf.writeUInt16LE(selection.b & 0xffff, 3);
      selBuf.writeUInt16LE(selection.c & 0xffff, 5);
      return Buffer.concat([
        DISCRIMINATORS.PLACE_BET,
        selBuf,
        stakeBuf,
      ]);
    })();

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: userPublicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: betPda, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: false },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOSSR_PROGRAM_ID,
      data: placeBetData,
    });

    const ixs: TransactionInstruction[] = [];

    const [userAtaInfo, vaultAtaInfo] = await Promise.all([
      this.connection.getAccountInfo(userTokenAccount),
      this.connection.getAccountInfo(vaultTokenAccount),
    ]);

    if (!opts?.useER) {
      if (!userAtaInfo) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            userPublicKey,
            userTokenAccount,
            userPublicKey,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );
      }

      if (!vaultAtaInfo) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            userPublicKey,
            vaultTokenAccount,
            vaultPda,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );
      }

      const isNative = mint.equals(NATIVE_MINT);
      if (isNative) {
        ixs.push(
          SystemProgram.transfer({ fromPubkey: userPublicKey, toPubkey: userTokenAccount, lamports: stakeAmount })
        );
        ixs.push(createSyncNativeInstruction(userTokenAccount));
      }
    }

    const transaction = new Transaction().add(...ixs, instruction);
    const provider = opts?.useER ? this.erConnection : this.connection;

    const maxAttempts = 5;
    let blockhash: string | undefined;
    let lastError: unknown;
    let triedFallback = false;
    let currentProvider = provider;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await currentProvider.getLatestBlockhash();
        blockhash = result.blockhash;
        break;
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || '');

        if (!triedFallback && opts?.useER && (msg.includes('fetch failed') || msg.includes('403') || msg.includes('UND_ERR_CONNECT_TIMEOUT'))) {
          currentProvider = this.connection;
          triedFallback = true;
          logger.warn({ attempt }, 'Ephemeral RPC failed, falling back to Syndica RPC for blockhash');
          continue;
        }

        if (msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT')) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }

    if (!blockhash) {
      logger.error({ lastError, useER: opts?.useER }, 'Failed to get blockhash after all retries');
      throw lastError || new Error('Failed to get recent blockhash');
    }

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPublicKey;

    return { transaction, betPda };
  }

  async settleBet(
    marketId: PublicKey,
    roundNumber: number,
    userPublicKey: PublicKey,
    mint: PublicKey,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    // Bet PDA: [BET_SEED, round.key(), user.key()]
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, roundPda.toBuffer(), userPublicKey.toBuffer()],
      TOSSR_PROGRAM_ID
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, marketId.toBuffer()],
      TOSSR_PROGRAM_ID
    );

    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      userPublicKey
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(
      mint,
      vaultPda,
      true
    );

    const settleBetData = Buffer.from(DISCRIMINATORS.SETTLE_BET);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: betPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: false },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: userPublicKey, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOSSR_PROGRAM_ID,
      data: settleBetData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    logger.info({ signature, betPda: betPda.toString() }, 'Bet settled on-chain');

    return signature;
  }

  async openRound(
    marketId: PublicKey,
    roundNumber: number,
    adminKeypair: Keypair
  ): Promise<{ signature: string; roundPda: PublicKey }> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const openRoundData = DISCRIMINATORS.OPEN_ROUND;

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: true },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOSSR_PROGRAM_ID,
      data: openRoundData,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    logger.info({ signature, roundPda: roundPda.toString() }, 'Round opened on-chain');

    return { signature, roundPda };
  }

  async getMarketState(marketId: PublicKey): Promise<{ lastRound: number; isActive: boolean }> {
    const info = await this.connection.getAccountInfo(marketId);
    if (!info) {
      throw new Error(`Market ${marketId.toBase58()} not initialized on-chain`);
    }

    let decoded: any;
    try {
      decoded = this.coder.accounts.decode('Market', info.data);
    } catch (error) {
      logger.error({ marketId: marketId.toBase58(), error }, 'Failed to decode market account');
      throw error;
    }
    const lastRoundSource = decoded.lastRound ?? decoded.last_round ?? 0;
    const lastRoundValue = typeof lastRoundSource === 'number'
      ? lastRoundSource
      : typeof lastRoundSource?.toNumber === 'function'
        ? lastRoundSource.toNumber()
        : Number(lastRoundSource ?? 0);

    const activeFlag =
      typeof decoded.isActive === 'boolean'
        ? decoded.isActive
        : typeof decoded.is_active === 'boolean'
          ? decoded.is_active
          : Boolean(decoded.isActive ?? decoded.is_active);

    return {
      lastRound: lastRoundValue,
      isActive: activeFlag,
    };
  }

  async lockRound(
    marketId: PublicKey,
    roundNumber: number,
    adminKeypair: Keypair,
    opts?: { useER?: boolean }
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const lockRoundData = DISCRIMINATORS.LOCK_ROUND;

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data: lockRoundData,
    });

    const provider = opts?.useER ? this.erConnection : this.connection;

    const maxAttempts = 5;
    let signature: string | undefined;
    let lastError: unknown;
    let triedFallback = false;
    let currentProvider = provider;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tx = new Transaction().add(instruction);
        const { blockhash } = await currentProvider.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = adminKeypair.publicKey;
        const sig = await currentProvider.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
        await currentProvider.confirmTransaction(sig, 'finalized');
        signature = sig;
        break;
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || '');

        if (!triedFallback && opts?.useER && (msg.includes('Blockhash not found') || msg.includes('fetch failed') || msg.includes('403') || msg.includes('UND_ERR_CONNECT_TIMEOUT'))) {
          currentProvider = this.connection;
          triedFallback = true;
          logger.warn({ attempt, roundNumber }, 'Ephemeral RPC failed for lock, falling back to Syndica RPC for blockhash');
          continue;
        }

        if (msg.includes('Blockhash not found') || msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT')) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }

    if (!signature) {
      logger.error({ lastError, useER: opts?.useER, roundNumber }, 'Failed to lock round after all retries');
      throw lastError || new Error('Failed to lock round');
    }

    logger.info({ signature, roundPda: roundPda.toString(), useER: opts?.useER }, 'Round locked on-chain');

    return signature;
  }

  async settleRound(
    marketId: PublicKey,
    roundNumber: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const data = DISCRIMINATORS.SETTLE_ROUND;

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    return signature;
  }

  async commitOutcomeHash(
    marketId: PublicKey,
    roundNumber: number,
    commitmentHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.COMMIT_OUTCOME_HASH,
      commitmentHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature, 'finalized');

    return signature;
  }

  async revealOutcome(
    marketId: PublicKey,
    roundNumber: number,
    value: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_NUMERIC,
      Buffer.from(new Uint16Array([value]).buffer),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    logger.info({ signature, roundPda: roundPda.toString(), value }, 'Outcome revealed on-chain');

    return signature;
  }

  async revealShapeOutcome(
    marketId: PublicKey,
    roundNumber: number,
    shape: number,
    color: number,
    size: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_SHAPE,
      Buffer.from([shape, color, size]),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    logger.info({ signature, roundPda: roundPda.toString(), shape, color, size }, 'Shape outcome revealed');

    return signature;
  }

  async revealPatternOutcome(
    marketId: PublicKey,
    roundNumber: number,
    patternId: number,
    matchedValue: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_PATTERN,
      Buffer.from([patternId & 0xff]),
      Buffer.from(new Uint16Array([matchedValue]).buffer),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    logger.info({ signature, roundPda: roundPda.toString(), patternId, matchedValue }, 'Pattern outcome revealed');

    return signature;
  }

  async revealOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    value: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_NUMERIC,
      Buffer.from(new Uint16Array([value]).buffer),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.erConnection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
    await this.erConnection.confirmTransaction(sig);
    return sig;
  }

  async revealShapeOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    shape: number,
    color: number,
    size: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_SHAPE,
      Buffer.from([shape & 0xff, color & 0xff, size & 0xff]),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.erConnection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
    await this.erConnection.confirmTransaction(sig);
    return sig;
  }

  async revealPatternOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    patternId: number,
    matchedValue: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_PATTERN,
      Buffer.from([patternId & 0xff]),
      Buffer.from(new Uint16Array([matchedValue]).buffer),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.erConnection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
    await this.erConnection.confirmTransaction(sig);
    return sig;
  }

  async revealEntropyOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    teeScore: number,
    chainScore: number,
    sensorScore: number,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_ENTROPY,
      Buffer.from(new Uint16Array([teeScore]).buffer),
      Buffer.from(new Uint16Array([chainScore]).buffer),
      Buffer.from(new Uint16Array([sensorScore]).buffer),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.erConnection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
    await this.erConnection.confirmTransaction(sig);
    return sig;
  }

  async revealCommunityOutcomeER(
    marketId: PublicKey,
    roundNumber: number,
    finalByte: number,
    seedHash: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.ER_REVEAL_OUTCOME_COMMUNITY,
      Buffer.from([finalByte & 0xff]),
      seedHash,
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.erConnection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
    await this.erConnection.confirmTransaction(sig);
    return sig;
  }

  async requestRandomnessER(
    marketId: PublicKey,
    roundNumber: number,
    clientSeed: number,
    payer: Keypair,
    oracleQueue: PublicKey,
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const data = Buffer.concat([
      DISCRIMINATORS.REQUEST_RANDOMNESS,
      Buffer.from([clientSeed & 0xff]),
    ]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: oracleQueue, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    const sig = await this.erConnection.sendTransaction(tx, [payer], { skipPreflight: false });
    await this.erConnection.confirmTransaction(sig);
    return sig;
  }

  async commitRoundStateER(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];
    const ix = new TransactionInstruction({ keys, programId: TOSSR_PROGRAM_ID, data: DISCRIMINATORS.COMMIT_ROUND });
    const tx = new Transaction().add(ix);
    const { blockhash } = await this.erConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    const sig = await this.erConnection.sendTransaction(tx, [payer], { skipPreflight: false });
    await this.erConnection.confirmTransaction(sig);
    return sig;
  }

  async commitAndUndelegateRoundER(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];
    const ix = new TransactionInstruction({ keys, programId: TOSSR_PROGRAM_ID, data: DISCRIMINATORS.COMMIT_AND_UNDELEGATE_ROUND });

    const maxAttempts = 5;
    let signature: string | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tx = new Transaction().add(ix);
        const { blockhash } = await this.erConnection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = payer.publicKey;
        const sig = await this.erConnection.sendTransaction(tx, [payer], { skipPreflight: false });
        await this.erConnection.confirmTransaction(sig);
        signature = sig;
        break;
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || '');

        if (msg.includes('Blockhash not found') || msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT') || msg.includes('403')) {
          logger.warn({ attempt, roundNumber, error: msg }, 'ER transaction failed, retrying with Magic Router');
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }

    if (!signature) {
      logger.error({ lastError, roundNumber }, 'Failed to commit/undelegate round after all retries');
      throw lastError || new Error('Failed to commit and undelegate round');
    }

    return signature;
  }

  async revealEntropyOutcome(
    marketId: PublicKey,
    roundNumber: number,
    teeScore: number,
    chainScore: number,
    sensorScore: number,
    winner: number,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_ENTROPY,
      Buffer.from(new Uint16Array([teeScore]).buffer),
      Buffer.from(new Uint16Array([chainScore]).buffer),
      Buffer.from(new Uint16Array([sensorScore]).buffer),
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    logger.info({ signature, roundPda: roundPda.toString(), winner }, 'Entropy outcome revealed');

    return signature;
  }

  async revealCommunityOutcome(
    marketId: PublicKey,
    roundNumber: number,
    finalByte: number,
    seedHash: Buffer,
    nonce: Buffer,
    inputsHash: Buffer,
    attestationSig: Buffer,
    adminKeypair: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const data = Buffer.concat([
      DISCRIMINATORS.REVEAL_OUTCOME_COMMUNITY,
      Buffer.from([finalByte]),
      seedHash,
      nonce,
      inputsHash,
      attestationSig,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = adminKeypair.publicKey;

    const signature = await this.connection.sendTransaction(
      transaction,
      [adminKeypair],
      { skipPreflight: false }
    );

    await this.connection.confirmTransaction(signature);

    logger.info({ signature, roundPda: roundPda.toString(), finalByte }, 'Community outcome revealed');

    return signature;
  }

  async delegateRound(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair,
    validatorPubkey?: PublicKey
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    await this.waitForAccountInitialization(roundPda);

    const bufferPda = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(roundPda, TOSSR_PROGRAM_ID);
    const delegationRecordPda = delegationRecordPdaFromDelegatedAccount(roundPda);
    const delegationMetadataPda = delegationMetadataPdaFromDelegatedAccount(roundPda);

    const data = DISCRIMINATORS.DELEGATE_ROUND;

    const attemptDelegate = async () => {
      const keys = [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: bufferPda, isSigner: false, isWritable: true },
        { pubkey: delegationRecordPda, isSigner: false, isWritable: true },
        { pubkey: delegationMetadataPda, isSigner: false, isWritable: true },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: marketId, isSigner: false, isWritable: false },
        { pubkey: roundPda, isSigner: false, isWritable: true },
        { pubkey: TOSSR_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: DELEGATION_PROGRAM_PK, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ...(validatorPubkey ? [{ pubkey: validatorPubkey, isSigner: false, isWritable: false }] : []),
      ];

      const instruction = new TransactionInstruction({
        keys,
        programId: TOSSR_PROGRAM_ID,
        data,
      });

      const transaction = new Transaction().add(instruction);
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payer.publicKey;

      const signature = await this.connection.sendTransaction(transaction, [payer], {
        skipPreflight: false,
      });

      await this.connection.confirmTransaction(signature);

      logger.info({ signature, roundPda: roundPda.toString() }, 'Round delegated');

      return signature;
    };

    const maxAttempts = 4;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          await this.sleep(750 * attempt);
          await this.waitForAccountInitialization(roundPda);
        }
        return await attemptDelegate();
      } catch (err: any) {
        const message = String(err?.message || '');
        if (
          message.includes('AccountNotInitialized') ||
          message.includes('not initialized on-chain') ||
          message.includes('0xbc4')
        ) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async ensureRoundUndelegated(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<void> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const account = await this.connection.getAccountInfo(roundPda, 'finalized');
    if (account && account.owner.equals(TOSSR_PROGRAM_ID)) {
      return;
    }

    await this.commitAndUndelegateRoundER(marketId, roundNumber, payer);

    for (let attempt = 0; attempt < 6; attempt++) {
      const info = await this.connection.getAccountInfo(roundPda, 'finalized');
      if (info && info.owner.equals(TOSSR_PROGRAM_ID) && info.data.length > 0) {
        return;
      }
      await this.sleep(500 * (attempt + 1));
    }

    throw new Error(`Round account ${roundPda.toBase58()} is still delegated after commit/undelegate`);
  }

  private async waitForAccountInitialization(
    pubkey: PublicKey,
    timeoutMs = 45000,
    intervalMs = 1000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await this.connection.getAccountInfo(pubkey, 'finalized');
      if (info && info.data.length > 0 && info.owner.equals(TOSSR_PROGRAM_ID)) {
        return;
      }
      await this.sleep(intervalMs);
    }
    throw new Error(`Account ${pubkey.toBase58()} not initialized on-chain`);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async commitRoundState(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];

    const data = DISCRIMINATORS.COMMIT_ROUND;

    const instruction = new TransactionInstruction({
      keys,
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const maxAttempts = 5;
    let signature: string | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const transaction = new Transaction().add(instruction);
        const { blockhash } = await this.erConnection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = payer.publicKey;
        const sig = await this.erConnection.sendTransaction(transaction, [payer], { skipPreflight: false });
        await this.erConnection.confirmTransaction(sig);
        signature = sig;
        break;
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || '');

        if (msg.includes('Blockhash not found') || msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT') || msg.includes('403')) {
          logger.warn({ attempt, roundNumber, error: msg }, 'ER transaction failed, retrying with Magic Router');
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }

    if (!signature) {
      logger.error({ lastError, roundNumber }, 'Failed to commit state after all retries');
      throw lastError || new Error('Failed to commit round state');
    }

    logger.info({ signature, roundPda: roundPda.toString() }, 'Round state committed');

    return signature;
  }

  async commitAndUndelegateRound(
    marketId: PublicKey,
    roundNumber: number,
    payer: Keypair
  ): Promise<string> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));

    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );

    const keys = [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketId, isSigner: false, isWritable: false },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_PK, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_PK, isSigner: false, isWritable: true },
    ];

    const data = DISCRIMINATORS.COMMIT_AND_UNDELEGATE_ROUND;

    const instruction = new TransactionInstruction({
      keys,
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const maxAttempts = 5;
    let signature: string | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const transaction = new Transaction().add(instruction);
        const { blockhash} = await this.erConnection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = payer.publicKey;
        const sig = await this.erConnection.sendTransaction(transaction, [payer], { skipPreflight: false });
        await this.erConnection.confirmTransaction(sig);
        signature = sig;
        break;
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || '');

        if (msg.includes('Blockhash not found') || msg.includes('fetch failed') || msg.includes('UND_ERR_CONNECT_TIMEOUT') || msg.includes('403')) {
          logger.warn({ attempt, roundNumber, error: msg }, 'ER transaction failed, retrying with Magic Router');
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }

    if (!signature) {
      logger.error({ lastError, roundNumber }, 'Failed to commit/undelegate round after all retries');
      throw lastError || new Error('Failed to commit and undelegate round');
    }

    logger.info({ signature, roundPda: roundPda.toString() }, 'Round committed and undelegated');

    return signature;
  }

  private async getBetCounter(roundPda: PublicKey): Promise<number> {
    try {
      const accountInfo = await this.connection.getAccountInfo(roundPda);
      if (!accountInfo) return 0;

      const data = accountInfo.data;
      const unsettledBets = data.readUInt32LE(8 + 32 + 8 + 1 + 32);
      return unsettledBets;
    } catch {
      return 0;
    }
  }

  async getRoundPda(marketId: PublicKey, roundNumber: number): Promise<PublicKey> {
    const roundNumberBuffer = Buffer.alloc(8);
    roundNumberBuffer.writeBigUInt64LE(BigInt(roundNumber));
    
    const [roundPda] = PublicKey.findProgramAddressSync(
      [ROUND_SEED, marketId.toBuffer(), roundNumberBuffer],
      TOSSR_PROGRAM_ID
    );
    return roundPda;
  }

  async getMarketPda(adminPublicKey: PublicKey): Promise<PublicKey> {
    const indexBuf = Buffer.alloc(2);
    indexBuf.writeUInt16LE(0, 0);
    const [marketPda] = PublicKey.findProgramAddressSync(
      [MARKET_SEED, adminPublicKey.toBuffer(), indexBuf],
      TOSSR_PROGRAM_ID
    );
    return marketPda;
  }

  async getMarketPdaByIndex(adminPublicKey: PublicKey, index: number): Promise<PublicKey> {
    const indexBuf = Buffer.alloc(2);
    indexBuf.writeUInt16LE(index & 0xffff, 0);
    const [marketPda] = PublicKey.findProgramAddressSync(
      [MARKET_SEED, adminPublicKey.toBuffer(), indexBuf],
      TOSSR_PROGRAM_ID
    );
    return marketPda;
  }

  async initializeMarket(
    adminKeypair: Keypair,
    name: string,
    houseEdgeBps: number,
    marketTypeDiscriminant: number,
    index: number,
    mint: PublicKey,
  ): Promise<{ signature: string; marketPda: PublicKey }> {
    const marketPda = await this.getMarketPdaByIndex(adminKeypair.publicKey, index);
    const idlPath = path.resolve(__dirname, '../../../contracts/anchor/target/idl/tossr_engine.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl;
    const coder = new BorshCoder(idl as any);
    const variant = [
      { PickRange: {} },
      { EvenOdd: {} },
      { LastDigit: {} },
      { ModuloThree: {} },
      { PatternOfDay: {} },
      { ShapeColor: {} },
      { Jackpot: {} },
      { EntropyBattle: {} },
      { StreakMeter: {} },
      { CommunitySeed: {} },
    ][marketTypeDiscriminant] || { PickRange: {} };
    const data = coder.instruction.encode('initialize_market', {
      name,
      house_edge_bps: houseEdgeBps,
      market_type: variant,
      market_index: index,
    });

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: marketPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOSSR_PROGRAM_ID,
      data,
    });

    const tx = new Transaction().add(ix);
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;
    const sig = await this.connection.sendTransaction(tx, [adminKeypair], { skipPreflight: false });
    await this.connection.confirmTransaction(sig);
    return { signature: sig, marketPda };
  }

  async getBetPda(roundPda: PublicKey, userPublicKey: PublicKey): Promise<PublicKey> {
    const [betPda] = PublicKey.findProgramAddressSync(
      [BET_SEED, roundPda.toBuffer(), userPublicKey.toBuffer()],
      TOSSR_PROGRAM_ID
    );
    return betPda;
  }

  async getVaultPda(marketId: PublicKey): Promise<PublicKey> {
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, marketId.toBuffer()],
      TOSSR_PROGRAM_ID
    );
    return vaultPda;
  }
}
