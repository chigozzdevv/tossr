import { db } from '@/config/database';
import { RoundStatus } from '@/shared/types';
import { NotFoundError, ConflictError } from '@/shared/errors';
import { TossrProgramService } from '@/solana/tossr-program-service';
import { TeeService } from '@/solana/tee-service';
import { getAdminKeypair } from '@/config/admin-keypair';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMarketConfig } from '@/utils/market-config';
import { roundLifecycleQueue, betSettlementQueue } from '@/jobs/queues';
import { fetchRoundStateRaw } from '@/solana/round-reader';

const tossrProgram = new TossrProgramService();
const teeService = new TeeService();

const ER_VALIDATOR = new PublicKey(config.ER_VALIDATOR_PUBKEY);

export class RoundsService {
  async openRound(marketId: string) {
    const market = await db.market.findUnique({ where: { id: marketId } });
    if (!market) {
      throw new NotFoundError('Market');
    }

    if (!market.isActive) {
      throw new ConflictError('Market is not active');
    }

    const existingActiveRound = await db.round.findFirst({
      where: {
        marketId,
        status: { in: [RoundStatus.PREDICTING, RoundStatus.LOCKED] },
      },
    });

    if (existingActiveRound) {
      throw new ConflictError('Market already has an active round');
    }

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig(market.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    const lastRound = await db.round.findFirst({
      where: { marketId },
      orderBy: { roundNumber: 'desc' },
    });

    let roundNumber = (lastRound?.roundNumber || 0) + 1;

    let roundPda: PublicKey | null = null;
    let signature: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await tossrProgram.openRound(marketPubkey, roundNumber, adminKeypair);
        signature = res.signature;
        roundPda = res.roundPda;
        break;
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (msg.includes('2006') || msg.includes('ConstraintSeeds')) {
          roundNumber += 1;
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        throw e;
      }
    }
    if (!roundPda || !signature) throw new Error('Failed to open round');

    const round = await db.round.upsert({
      where: { marketId_roundNumber: { marketId, roundNumber } as any },
      create: {
        marketId,
        roundNumber,
        status: RoundStatus.PREDICTING,
        openedAt: new Date(),
        solanaAddress: roundPda.toString(),
        openTxHash: signature,
      },
      update: {
        solanaAddress: roundPda.toString(),
        openTxHash: signature,
        status: RoundStatus.PREDICTING,
      },
    } as any);

    try {
      await this.delegateRoundToER(round.id, marketPubkey);
    } catch (error) {
      logger.error({ roundId: round.id, error }, 'Failed to delegate round');
      // keep DB row; scheduler can retry delegation
    }

    logger.info({ roundId: round.id, roundNumber, signature }, 'Round opened and delegated to ER');

    return round;
  }

  async delegateRoundToER(roundId: string, marketPubkey: PublicKey) {
    const adminKeypair = getAdminKeypair();
    const round = await db.round.findUnique({ where: { id: roundId } });

    if (!round) {
      throw new NotFoundError('Round');
    }

    const delegateTxHash = await tossrProgram.delegateRound(
      marketPubkey,
      round.roundNumber,
      adminKeypair,
      ER_VALIDATOR
    );

    await db.round.update({
      where: { id: roundId },
      data: { delegateTxHash },
    });

    logger.info({ roundId, delegateTxHash }, 'Round delegated to ER');
  }

  async lockRound(roundId: string) {
    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    if (round.status !== RoundStatus.PREDICTING) {
      throw new ConflictError('Round is not in predicting state');
    }

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig(round.market.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);

    let lockTxHash: string
    try {
      lockTxHash = await tossrProgram.lockRound(
        marketPubkey,
        round.roundNumber,
        adminKeypair
      )
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('6002') || msg.includes('InvalidState')) {
        lockTxHash = 'already-locked'
      } else {
        throw e
      }
    }

    await db.round.update({
      where: { id: roundId },
      data: {
        status: RoundStatus.LOCKED,
        lockedAt: new Date(),
        lockTxHash,
      },
    });

    logger.info({ roundId, lockTxHash }, 'Round locked');

    await this.generateAndCommitOutcome(roundId);

    return lockTxHash;
  }

  async generateAndCommitOutcome(roundId: string) {
    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig(round.market.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);

    const chainHash = await teeService.getLatestBlockhash();

    const attestation = await teeService.generateOutcome(
      roundId,
      round.market.type,
      { chainHash }
    );

    const commitmentHash = Buffer.from(attestation.commitment_hash, 'hex');
    const attestationSig = Buffer.from(attestation.signature, 'hex');

    const commitTxHash = await tossrProgram.commitOutcomeHash(
      marketPubkey,
      round.roundNumber,
      commitmentHash,
      attestationSig,
      adminKeypair
    );

    await db.round.update({
      where: { id: roundId },
      data: {
        attestation: JSON.stringify(attestation),
        commitTxHash,
      },
    });

    logger.info({ roundId, commitTxHash }, 'Outcome hash committed (hidden until reveal)');

    // Optional on-chain verification: ensure commitment hash stored on-chain matches
    try {
      const connection = new Connection(config.SOLANA_RPC_URL);
      const programId = new PublicKey(config.TOSSR_ENGINE_PROGRAM_ID);
      const roundPda = await tossrProgram.getRoundPda(marketPubkey, round.roundNumber);
      const maxAttempts = 5;
      let attempt = 0;
      let state = await fetchRoundStateRaw(connection, roundPda);
      while (attempt < maxAttempts && (!state || !state.commitmentHash)) {
        await new Promise(r => setTimeout(r, 500));
        state = await fetchRoundStateRaw(connection, roundPda);
        attempt++;
      }
      if (!state || !state.commitmentHash) {
        throw new Error('Commit verification failed: state not available');
      }
      if (state.commitmentHash.toLowerCase() !== attestation.commitment_hash.toLowerCase()) {
        throw new Error(`Commit verification failed: mismatch (expected ${attestation.commitment_hash}, on-chain ${state.commitmentHash})`);
      }
      logger.info({ roundId }, 'Commit verification passed');
    } catch (e) {
      // Make strict: abort the flow if commit not reflected on-chain as expected
      throw e;
    }

    await roundLifecycleQueue.add('reveal-outcome', { roundId }, {
      delay: config.LOCK_DURATION_SECONDS * 1000,
    });
  }

  async revealOutcome(roundId: string) {
    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round || !round.attestation) {
      throw new NotFoundError('Round or attestation');
    }

    const attestation = JSON.parse(round.attestation as any);
    const outcome = attestation.outcome;

    const nonce = Buffer.from(attestation.nonce, 'hex');
    const inputsHash = Buffer.from(attestation.inputs_hash, 'hex');
    const attestationSig = Buffer.from(attestation.signature, 'hex');

    const adminKeypair = getAdminKeypair();
    const marketConfig = getMarketConfig(round.market.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);

    let revealTxHash: string;

    if (outcome.Numeric) {
      revealTxHash = await tossrProgram.revealOutcome(
        marketPubkey,
        round.roundNumber,
        outcome.Numeric.value,
        nonce,
        inputsHash,
        attestationSig,
        adminKeypair
      );
    } else if (outcome.Shape) {
      revealTxHash = await tossrProgram.revealShapeOutcome(
        marketPubkey,
        round.roundNumber,
        outcome.Shape.shape,
        outcome.Shape.color,
        outcome.Shape.size,
        nonce,
        inputsHash,
        attestationSig,
        adminKeypair
      );
    } else if (outcome.Pattern) {
      revealTxHash = await tossrProgram.revealPatternOutcome(
        marketPubkey,
        round.roundNumber,
        outcome.Pattern.pattern_id,
        outcome.Pattern.matched_value,
        nonce,
        inputsHash,
        attestationSig,
        adminKeypair
      );
    } else if (outcome.Entropy) {
      revealTxHash = await tossrProgram.revealEntropyOutcome(
        marketPubkey,
        round.roundNumber,
        outcome.Entropy.tee_score,
        outcome.Entropy.chain_score,
        outcome.Entropy.sensor_score,
        outcome.Entropy.winner,
        nonce,
        inputsHash,
        attestationSig,
        adminKeypair
      );
    } else if (outcome.Community) {
      const seedHash = Buffer.from(outcome.Community.seed_hash, 'hex');
      revealTxHash = await tossrProgram.revealCommunityOutcome(
        marketPubkey,
        round.roundNumber,
        outcome.Community.final_byte,
        seedHash,
        nonce,
        inputsHash,
        attestationSig,
        adminKeypair
      );
    } else {
      throw new Error('Unsupported outcome type');
    }

    await db.round.update({
      where: { id: roundId },
      data: {
        revealTxHash,
        revealedAt: new Date(),
        outcome: JSON.stringify(outcome),
      },
    });

    logger.info({ roundId, revealTxHash }, 'Outcome revealed');

    // Optional on-chain verification: ensure revealed outcome and inputs_hash match
    try {
      const connection = new Connection(config.SOLANA_RPC_URL);
      const programId = new PublicKey(config.TOSSR_ENGINE_PROGRAM_ID);
      const marketConfig = getMarketConfig(round.market.config as unknown);
      const marketPubkey = new PublicKey(marketConfig.solanaAddress);
      const roundPda = await tossrProgram.getRoundPda(marketPubkey, round.roundNumber);
      const maxAttempts = 5;
      let attempt = 0;
      let state = await fetchRoundStateRaw(connection, roundPda);
      while (attempt < maxAttempts && !state) {
        await new Promise(r => setTimeout(r, 500));
        state = await fetchRoundStateRaw(connection, roundPda);
        attempt++;
      }
      const expectedInputs = Buffer.from(attestation.inputs_hash, 'hex').toString('hex');
      let outcomeMatches = false;
      if (state?.outcome) {
        // Compare by JSON shape, tolerant to field ordering
        outcomeMatches = JSON.stringify(state.outcome) === JSON.stringify(outcome);
      }
      const inputsMatch = (state?.inputsHash || '').toLowerCase() === expectedInputs.toLowerCase();
      if (!state) {
        throw new Error('Reveal verification failed: state not available');
      }
      if (!outcomeMatches || !inputsMatch) {
        throw new Error(`Reveal verification failed: outcome=${outcomeMatches}, inputsMatch=${inputsMatch}`);
      }
      logger.info({ roundId }, 'Reveal verification passed');
    } catch (e) {
      // Make strict: abort settlement/commit if reveal not reflected on-chain as expected
      throw e;
    }

    await betSettlementQueue.add('settle-bets', { roundId });
    await this.commitRoundStateToBase(roundId);
  }

  async commitRoundStateToBase(roundId: string) {
    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    const marketConfig = getMarketConfig(round.market.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    const adminKeypair = getAdminKeypair();

    const commitStateTxHash = await tossrProgram.commitRoundState(
      marketPubkey,
      round.roundNumber,
      adminKeypair
    );

    await db.round.update({
      where: { id: roundId },
      data: { commitStateTxHash },
    });

    logger.info({ roundId, commitStateTxHash }, 'Round state committed to base layer');
  }

  async undelegateRound(roundId: string) {
    const round = await db.round.findUnique({
      where: { id: roundId },
      include: { market: true },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    const marketConfig = getMarketConfig(round.market.config as unknown);
    const marketPubkey = new PublicKey(marketConfig.solanaAddress);
    const adminKeypair = getAdminKeypair();

    const undelegateTxHash = await tossrProgram.commitAndUndelegateRound(
      marketPubkey,
      round.roundNumber,
      adminKeypair
    );

    await db.round.update({
      where: { id: roundId },
      data: {
        status: RoundStatus.SETTLED,
        undelegateTxHash,
        settledAt: new Date(),
      },
    });

    logger.info({ roundId, undelegateTxHash }, 'Round undelegated and settled');

    return undelegateTxHash;
  }

  async getRound(roundId: string) {
    const round = await db.round.findUnique({
      where: { id: roundId },
      include: {
        market: true,
        bets: {
          select: {
            id: true,
            stake: true,
            selection: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!round) {
      throw new NotFoundError('Round');
    }

    return {
      ...round,
      bets: round.bets.map((bet: any) => ({
        ...bet,
        stake: Number(bet.stake),
      })),
    };
  }

  async getActiveRounds(marketId?: string) {
    const where: any = {
      status: { in: [RoundStatus.PREDICTING, RoundStatus.LOCKED] },
    };

    if (marketId) {
      where.marketId = marketId;
    }

    const rounds = await db.round.findMany({
      where,
      include: {
        market: {
          select: { name: true, type: true },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    return rounds;
  }
}
