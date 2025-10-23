import 'dotenv/config'
import { db } from '../config/database'
import { getAdminKeypair } from '../config/admin-keypair'
import { TossrProgramService } from '../solana/tossr-program-service'
import { Connection, PublicKey } from '@solana/web3.js'
import { config } from '../config/env'

const MT: Record<string, number> = {
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
}

async function main() {
  const admin = getAdminKeypair()
  const svc = new TossrProgramService()
  const connection = new Connection(config.SOLANA_RPC_URL)

  const markets = await db.market.findMany()
  for (const m of markets) {
    const cfg: any = m.config || {}
    const addr = cfg.solanaAddress
    const mint = cfg.mintAddress
    const bps: number = typeof cfg.houseEdgeBps === 'number' ? cfg.houseEdgeBps : 0
    if (!addr || !mint || !(m.type in MT)) continue
    const marketPk = new PublicKey(addr)
    const info = await connection.getAccountInfo(marketPk)
    if (info) continue

    let foundIndex: number | null = null
    for (let i = 0; i < 200; i++) {
      const pda = await svc.getMarketPdaByIndex(admin.publicKey, i)
      if (pda.equals(marketPk)) { foundIndex = i; break }
    }
    if (foundIndex === null) continue
    const res = await svc.initializeMarket(admin, m.name, bps, MT[m.type], foundIndex, new PublicKey(mint))
    console.log(JSON.stringify({ name: m.name, index: foundIndex, tx: res.signature, pda: res.marketPda.toString() }))
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
