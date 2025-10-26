import { Round } from '@/config/database'
import { RoundStatus } from '@/shared/types'
import { RoundsService } from '@/features/rounds/rounds.service'
import { logger } from '@/utils/logger'

const roundsService = new RoundsService()
let releasing = false
const TARGET_RPS = 100
const RELEASE_DELAY_MS = Math.ceil(1000 / TARGET_RPS)
const JITTER_MS = 10
const MAX_CONCURRENT_RELEASES = 1

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return []
  const buckets: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    buckets.push(items.slice(i, i + size))
  }
  return buckets
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function releaseQueuedRounds() {
  if (releasing) return
  releasing = true

  try {
    const now = new Date()
    const dueRounds = await Round.find({
      status: RoundStatus.QUEUED,
      $or: [ { scheduledReleaseAt: null }, { scheduledReleaseAt: { $lte: now } } ],
    })
    .populate({ path: 'marketId', model: 'Market' })
    .sort({ scheduledReleaseAt: 1 })
    .limit(50)
    .lean()

    if (dueRounds.length === 0) {
      return
    }

    const groups = new Map<string, Array<typeof dueRounds[number]>>()
    for (const round of dueRounds) {
      const key = (round as any).releaseGroupId || `manual-${(round as any)._id}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(round)
    }

    for (const [groupId, rounds] of groups.entries()) {
      logger.info({ releaseGroupId: groupId, count: rounds.length }, 'Releasing queued round batch')

      const successfulRoundIds: string[] = []
      for (const round of rounds) {
        try {
          await roundsService.releaseQueuedRound(String((round as any)._id))
          successfulRoundIds.push(String((round as any)._id))
          logger.info({ roundId: (round as any)._id, releaseGroupId: groupId }, 'Released queued round')
        } catch (reason: any) {
          logger.error({
            roundId: (round as any)._id,
            releaseGroupId: groupId,
            err: reason instanceof Error ? reason : undefined,
            errorMessage: reason instanceof Error ? reason.message : String(reason),
          }, 'Failed to release queued round')
        }

        const jitter = Math.floor(Math.random() * JITTER_MS)
        if (RELEASE_DELAY_MS + jitter > 0) {
          await sleep(RELEASE_DELAY_MS + jitter)
        }
      }

      if (successfulRoundIds.length > 0) {
        const syncTimestamp = new Date()
        await Round.updateMany({ _id: { $in: successfulRoundIds } }, { $set: { openedAt: syncTimestamp, releasedAt: syncTimestamp } })
        logger.info({ releaseGroupId: groupId, roundIds: successfulRoundIds }, 'Synchronized batch timestamps')
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Release queued rounds scheduler error')
  } finally {
    releasing = false
  }
}
