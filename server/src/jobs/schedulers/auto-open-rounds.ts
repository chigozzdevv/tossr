import { db } from '@/config/database'
import { RoundStatus } from '@/shared/types'
import { RoundsService } from '@/features/rounds/rounds.service'
import { logger } from '@/utils/logger'
import { config } from '@/config/env'

const roundsService = new RoundsService()
let running = false

export async function autoOpenRounds() {
  if (running) return
  running = true
  try {
    const markets = await db.market.findMany({ where: { isActive: true }, select: { id: true, name: true } })
    if (markets.length === 0) return

    const now = Date.now()
    const intervalMs = config.ROUND_RELEASE_INTERVAL_SECONDS * 1000
    const bufferMs = config.ROUND_QUEUE_BUFFER_SECONDS * 1000
    const targetTimestamp = Math.ceil((now + bufferMs) / intervalMs) * intervalMs
    const scheduledReleaseAt = new Date(targetTimestamp)
    const releaseGroupId = `batch-${scheduledReleaseAt.getTime()}`

    for (const market of markets) {
      const latest = await db.round.findFirst({
        where: { marketId: market.id },
        orderBy: { roundNumber: 'desc' },
      })

      if (latest) {
        if (latest.status === RoundStatus.PREDICTING) {
          logger.debug({ marketId: market.id, roundId: latest.id }, 'Market already has active round, skipping queue')
          continue
        }
        if (latest.status === RoundStatus.LOCKED) {
          const betCount = await db.bet.count({ where: { roundId: latest.id } })
          if (betCount === 0) {
            try {
              await roundsService.undelegateRound(latest.id)
              logger.info({ roundId: latest.id, marketId: market.id }, 'Expired stale locked round (no bets)')
            } catch (e) {
              logger.error({ roundId: latest.id, err: e }, 'Failed to expire stale locked round')
              continue
            }
          } else {
            logger.debug({ marketId: market.id, roundId: latest.id }, 'Locked round awaiting settlement, skipping queue')
            continue
          }
        }

        if (latest.status === RoundStatus.QUEUED) {
          const scheduled = latest.scheduledReleaseAt ? new Date(latest.scheduledReleaseAt).getTime() : null
          if (scheduled && Math.abs(scheduled - scheduledReleaseAt.getTime()) < intervalMs) {
            logger.debug({ marketId: market.id, roundId: latest.id }, 'Round already queued for upcoming batch')
            continue
          }
        }
      }

      try {
        const round = await roundsService.queueRound(market.id, scheduledReleaseAt, releaseGroupId)
        if (round.status === RoundStatus.QUEUED) {
          logger.info({ marketId: market.id, marketName: market.name, roundId: round.id, releaseGroupId }, 'Queued round for batch release')
        } else {
          logger.debug({ marketId: market.id, status: round.status }, 'Queue skipped due to existing round state')
        }
      } catch (e) {
        logger.error({ marketId: market.id, err: e }, 'Queue round failed')
      }
    }
  } catch (error) {
    logger.error({ error }, 'Auto-open scheduler error')
  } finally {
    running = false
  }
}
