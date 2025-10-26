import { Bet, User, Round, Attestation, Market } from '@/config/database';
import { config } from '@/config/env';

type Granularity = 'daily' | 'weekly';

export class AnalyticsService {
  async getOverview() {
    const [
      totalBets,
      wonBets,
      pendingBets,
      stakeAgg,
      payoutAgg,
      usersTotal,
      roundsSettled,
      attestationsTotal,
      attestationsVerified,
    ] = await Promise.all([
      Bet.countDocuments(),
      Bet.countDocuments({ status: 'WON' }),
      Bet.countDocuments({ status: 'PENDING' }),
      Bet.aggregate([{ $group: { _id: null, total: { $sum: '$stake' } } }]),
      Bet.aggregate([{ $match: { status: 'WON' } }, { $group: { _id: null, total: { $sum: '$payout' } } }]),
      User.countDocuments(),
      Round.countDocuments({ status: 'SETTLED' }),
      Attestation.countDocuments(),
      Attestation.countDocuments({ verified: true }),
    ]);

    const roundsForTiming = await Round.find({ lockedAt: { $ne: null }, revealedAt: { $ne: null }, settledAt: { $ne: null } })
      .select('lockedAt revealedAt settledAt')
      .limit(5000)
      .lean();
    let lockToRevealMs = 0;
    let revealToSettleMs = 0;
    if (roundsForTiming.length > 0) {
      for (const r of roundsForTiming) {
        lockToRevealMs += r.revealedAt!.getTime() - r.lockedAt!.getTime();
        revealToSettleMs += r.settledAt!.getTime() - r.revealedAt!.getTime();
      }
      lockToRevealMs = Math.round(lockToRevealMs / roundsForTiming.length);
      revealToSettleMs = Math.round(revealToSettleMs / roundsForTiming.length);
    }

    const totalStaked = Number((stakeAgg[0]?.total) || 0);
    const totalPaid = Number((payoutAgg[0]?.total) || 0);
    const profitLoss = totalPaid - totalStaked;
    const winRate = totalBets > 0 ? (wonBets / totalBets) * 100 : 0;
    const verificationRate = attestationsTotal > 0 ? (attestationsVerified / attestationsTotal) * 100 : 0;

    return {
      totals: {
        users: usersTotal,
        bets: totalBets,
        roundsSettled,
        pendingBets,
      },
      finance: {
        totalStaked,
        totalPaid,
        profitLoss,
        winRate: Math.round(winRate * 100) / 100,
      },
      attestations: {
        total: attestationsTotal,
        verified: attestationsVerified,
        verificationRate: Math.round(verificationRate * 100) / 100,
      },
      timings: {
        avgLockToRevealMs: lockToRevealMs,
        avgRevealToSettleMs: revealToSettleMs,
      },
    };
  }

  async getMarketMetrics() {
    const markets = await Market.find({}).select('name type').lean();
    const perMarketBets = await Bet.aggregate([
      { $group: { _id: '$marketId', totalBets: { $sum: 1 }, totalStake: { $sum: '$stake' }, totalPayout: { $sum: '$payout' } } }
    ]);
    const perMarketRounds = await Round.aggregate([{ $group: { _id: '$marketId', count: { $sum: 1 } } }]);
    const roundsSettledByMarket = await Round.aggregate([{ $match: { status: 'SETTLED' } }, { $group: { _id: '$marketId', count: { $sum: 1 } } }]);

    const roundsByMarketMap = new Map(perMarketRounds.map((r: any) => [String(r._id), r.count]));
    const settledByMarketMap = new Map(roundsSettledByMarket.map((r: any) => [String(r._id), r.count]));

    const result = markets.map((m: any) => {
      const b = perMarketBets.find((x: any) => String(x._id) === String(m._id));
      const totalStake = Number(b?.totalStake || 0);
      const totalPayout = Number(b?.totalPayout || 0);
      const totalBets = b?.totalBets || 0;
      const totalRounds = roundsByMarketMap.get(String(m._id)) || 0;
      const settledRounds = settledByMarketMap.get(String(m._id)) || 0;
      const avgBetsPerRound = Number(totalRounds) > 0 ? Math.round((Number(totalBets) / Number(totalRounds)) * 100) / 100 : 0;
      const profitLoss = totalPayout - totalStake;
      return {
        marketId: m.id,
        name: m.name,
        type: m.type,
        totals: {
          rounds: totalRounds,
          settledRounds,
          bets: totalBets,
        },
        finance: {
          totalStake,
          totalPayout,
          profitLoss,
        },
        ratios: {
          avgBetsPerRound,
        },
      };
    });

    return result;
  }

  async getUserMetrics() {
    const now = new Date();
    const d1 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [dau, wau, mau] = await Promise.all([
      this.countActiveUsersSince(d1),
      this.countActiveUsersSince(d7),
      this.countActiveUsersSince(d30),
    ]);

    return { dau, wau, mau };
  }

  async getTimeSeries(days: number = 14, granularity: Granularity = 'daily') {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const bets = await Bet.find({ createdAt: { $gte: since } }).select('createdAt stake payout').sort({ createdAt: 1 }).lean();

    const byKey = new Map<string, { date: string; bets: number; volume: number; payout: number }>();
    const toKey = (d: Date) => {
      if (granularity === 'weekly') {
        // ISO week key: YYYY-WW
        const wd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = wd.getUTCDay() || 7;
        wd.setUTCDate(wd.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(wd.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((wd.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return `${wd.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      }
      return d.toISOString().slice(0, 10);
    };

    for (const b of bets) {
      const key = toKey(b.createdAt);
      const entry = byKey.get(key) || { date: key, bets: 0, volume: 0, payout: 0 };
      entry.bets += 1;
      entry.volume += Number(b.stake);
      entry.payout += Number(b.payout || 0);
      byKey.set(key, entry);
    }

    return Array.from(byKey.values());
  }

  private async countActiveUsersSince(since: Date) {
    const distinct = await Bet.distinct('userId', { createdAt: { $gte: since } });
    return distinct.length;
  }
}
