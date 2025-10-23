import { db } from '@/config/database'
import { RoundStatus } from '@/shared/types'
import { RoundsService } from '@/features/rounds/rounds.service'
import { logger } from '@/utils/logger'

const roundsService = new RoundsService()
let running = false

export async function autoOpenRounds() {
  if (running) return
  running = true
  try {
    const market = await db.market.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
    if (!market) return
    const active = await db.round.findFirst({ where: { marketId: market.id, status: { in: [RoundStatus.PREDICTING, RoundStatus.LOCKED] } }, select: { id: true } })
    if (active) return
    try {
      const round = await roundsService.openRound(market.id)
      logger.info({ marketId: market.id, marketName: market.name, roundId: round.id }, 'Auto-opened round')
    } catch (e) {
      logger.error({ marketId: market.id, err: e }, 'Auto-open round failed')
    }
  } catch (error) {
    logger.error({ error }, 'Auto-open scheduler error')
  } finally {
    running = false
  }
}
