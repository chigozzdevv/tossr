#!/usr/bin/env node
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PublicKey } = require('@solana/web3.js');

const prisma = new PrismaClient();

async function main() {
  const programId = new PublicKey(process.env.TOSSR_ENGINE_PROGRAM_ID);
  const adminArr = JSON.parse(process.env.ADMIN_PRIVATE_KEY);
  const adminPkBytes = Buffer.from(adminArr).subarray(32, 64); // not needed, just parse env
  const adminPubKey = (function () {
    const nacl = require('tweetnacl');
    const kp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(adminArr));
    return new PublicKey(kp.publicKey);
  })();
  const markets = await prisma.market.findMany();
  const MARKET_SEED = Buffer.from('market');
  const map = {};
  for (let i = 0; i < 200; i++) {
    const idxBuf = Buffer.alloc(2); idxBuf.writeUInt16LE(i, 0);
    const [pda] = PublicKey.findProgramAddressSync([MARKET_SEED, adminPubKey.toBuffer(), idxBuf], programId);
    map[pda.toString()] = i;
  }
  for (const m of markets) {
    const addr = m.config?.solanaAddress;
    if (!addr) continue;
    console.log(JSON.stringify({ name: m.name, addr, index: map[addr] ?? null }));
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
