#!/usr/bin/env node
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, Keypair } = require('@solana/web3.js');
const { createHash } = require('crypto');

function getDiscriminator(name) {
  const h = createHash('sha256').update(`global:${name}`).digest();
  return Buffer.from(h.subarray(0, 8));
}

const DISC = {
  INITIALIZE_MARKET: getDiscriminator('initialize_market'),
};

const MT = {
  PICK_RANGE: 0,
  EVEN_ODD: 1,
  LAST_DIGIT: 2,
  MODULO_THREE: 3,
  PATTERN_OF_DAY: 4,
  SHAPE_COLOR: 5,
  JACKPOT: 6,
  ENTROPY_BATTLE: 7,
  STREAK_METER: 8,
  COMMUNITY_SEED: 9,
};

const MARKET_SEED = Buffer.from('market');

function getAdminKeypair() {
  if (!process.env.ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY missing');
  const arr = JSON.parse(process.env.ADMIN_PRIVATE_KEY);
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

async function main() {
  const prisma = new PrismaClient();
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const programId = new PublicKey(process.env.TOSSR_ENGINE_PROGRAM_ID);
  const connection = new Connection(rpcUrl);
  const admin = getAdminKeypair();

  const markets = await prisma.market.findMany();
  for (const m of markets) {
    const cfg = m.config || {};
    const addr = cfg.solanaAddress;
    const mintAddr = cfg.mintAddress;
    const bps = typeof cfg.houseEdgeBps === 'number' ? cfg.houseEdgeBps : 0;
    const typeCode = MT[m.type];
    if (!addr || !mintAddr || typeCode === undefined) continue;
    const marketPk = new PublicKey(addr);
    const info = await connection.getAccountInfo(marketPk);
    if (info) {
      console.log(JSON.stringify({ name: m.name, status: 'exists', pda: addr }));
      continue;
    }

    let foundIndex = null;
    for (let i = 0; i < 200; i++) {
      const idxBuf = Buffer.alloc(2);
      idxBuf.writeUInt16LE(i, 0);
      const [pda] = PublicKey.findProgramAddressSync([MARKET_SEED, admin.publicKey.toBuffer(), idxBuf], programId);
      if (pda.equals(marketPk)) { foundIndex = i; break; }
    }
    if (foundIndex === null) {
      console.log(JSON.stringify({ name: m.name, status: 'index_not_found' }));
      continue;
    }

    const nameBytes = Buffer.from(m.name, 'utf8');
    const nameLen = Buffer.alloc(4); nameLen.writeUInt32LE(nameBytes.length, 0);
    const edgeBuf = Buffer.alloc(2); edgeBuf.writeUInt16LE(bps & 0xffff, 0);
    const typeBuf = Buffer.from([typeCode & 0xff]);
    const indexBuf = Buffer.alloc(2); indexBuf.writeUInt16LE(foundIndex & 0xffff, 0);
    const data = Buffer.concat([DISC.INITIALIZE_MARKET, nameLen, nameBytes, edgeBuf, typeBuf, indexBuf]);
    const keys = [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: marketPk, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mintAddr), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    const ix = new TransactionInstruction({ keys, programId, data });

    const tx = new Transaction().add(ix);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = admin.publicKey;
    const sig = await connection.sendTransaction(tx, [admin], { skipPreflight: false });
    await connection.confirmTransaction(sig);
    console.log(JSON.stringify({ name: m.name, status: 'initialized', index: foundIndex, tx: sig, pda: addr }));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
