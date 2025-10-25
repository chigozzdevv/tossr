import { db } from '@/config/database'
import { RoundStatus } from '@/shared/types'
import { RoundsService } from '@/features/rounds/rounds.service'
import { logger } from '@/utils/logger'

const roundsService = new RoundsService()
let releasing = false
const MAX_RPC_RPS = 100
const RELEASE_DELAY_MS = Math.ceil(1000 / MAX_RPC_RPS)
const MAX_CONCURRENT_RELEASES = 4

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return []
  const buckets: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    buckets.push(items.slice(i, i + size))
  }
  return buckets
}

export async function releaseQueuedRounds() {
  if (releasing) return
  releasing = true

  try {
    const now = new Date()
    const dueRounds = await db.round.findMany({
      where: {
        status: RoundStatus.QUEUED,
        OR: [
          { scheduledReleaseAt: null },
          { scheduledReleaseAt: { lte: now } },
        ],
      },
      include: { market: true },
      orderBy: { scheduledReleaseAt: 'asc' },
      take: 50,
    })

    if (dueRounds.length === 0) {
      return
    }

    const groups = new Map<string, Array<typeof dueRounds[number]>>()
    for (const round of dueRounds) {
      const key = round.releaseGroupId || `manual-${round.id}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(round)
    }

    for (const [groupId, rounds] of groups.entries()) {
      logger.info({ releaseGroupId: groupId, count: rounds.length }, 'Releasing queued round batch')

      const successfulRoundIds: string[] = []
      const roundChunks = chunk(rounds, MAX_CONCURRENT_RELEASES)

      for (const slice of roundChunks) {
        const results = await Promise.allSettled(
          slice.map((round) => roundsService.releaseQueuedRound(round.id))
        )

        for (let idx = 0; idx < slice.length; idx++) {
          const round = slice[idx]
          const result = results[idx]

          if (!round || !result) continue

          if (result.status === 'fulfilled') {
            successfulRoundIds.push(round.id)
            logger.info({ roundId: round.id, releaseGroupId: groupId }, 'Released queued round')
          } else {
            const reason = result.reason
            logger.error({
              roundId: round.id,
              releaseGroupId: groupId,
              err: reason instanceof Error ? reason : undefined,
              errorMessage: reason instanceof Error ? reason.message : String(reason),
            }, 'Failed to release queued round')
          }
        }

        if (RELEASE_DELAY_MS > 0) {
          await new Promise((resolve) => setTimeout(resolve, RELEASE_DELAY_MS))
        }
      }

      if (successfulRoundIds.length > 0) {
        const syncTimestamp = new Date()
        await db.round.updateMany({
          where: { id: { in: successfulRoundIds } },
          data: {
            openedAt: syncTimestamp,
            releasedAt: syncTimestamp,
          },
        })
        logger.info({ releaseGroupId: groupId, roundIds: successfulRoundIds }, 'Synchronized batch timestamps')
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Release queued rounds scheduler error')
  } finally {
    releasing = false
  }
}
