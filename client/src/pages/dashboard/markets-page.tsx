import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { marketsService, type MarketSummary } from '@/services/markets.service'

type MarketCard = MarketSummary & {
  accent: string
  activityScore: number
  description: string
}

type MarketFilter = {
  id: string
  label: string
  predicate: (market: MarketCard) => boolean
}

const ACCENT_POOL = [
  'linear-gradient(135deg, rgba(185,246,201,0.28), rgba(52,211,153,0.18))',
  'linear-gradient(135deg, rgba(129,140,248,0.3), rgba(59,130,246,0.2))',
  'linear-gradient(135deg, rgba(244,114,182,0.32), rgba(236,72,153,0.2))',
  'linear-gradient(135deg, rgba(248,196,113,0.3), rgba(251,146,60,0.2))',
  'linear-gradient(135deg, rgba(168,85,247,0.32), rgba(109,40,217,0.2))',
]

const DESCRIPTIONS: Record<string, string> = {
  PICK_RANGE: 'Partitioned number ranges with attested randomness.',
  EVEN_ODD: 'Quick parity plays powered by VRF proofs.',
  LAST_DIGIT: 'Predict last digits with tight time windows.',
  MODULO_THREE: 'Modulo outcomes tuned for streak players.',
  PATTERN_OF_DAY: 'Dynamic pattern recognition markets.',
  SHAPE_COLOR: 'Shape, color and size combinatorics.',
  JACKPOT: 'High-volatility jackpot pools.',
  ENTROPY_BATTLE: 'Entropy face-off between data sources.',
  STREAK_METER: 'Chase streak multipliers for legendary runs.',
  COMMUNITY_SEED: 'Crowd-sourced randomness with shared rewards.',
}

function humanize(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())
}

function createFilters(markets: MarketCard[]): MarketFilter[] {
  const filters: MarketFilter[] = [{ id: 'all', label: 'All', predicate: () => true }]
  if (markets.some((market) => market.isActive)) {
    filters.push({ id: 'active', label: 'Active', predicate: (market) => market.isActive })
  }
  const maxBets = markets.reduce((max, market) => Math.max(max, market._count?.bets ?? 0), 0)
  if (maxBets > 0) {
    filters.push({
      id: 'popular',
      label: 'Popular',
      predicate: (market) => (market._count?.bets ?? 0) >= Math.max(3, Math.floor(maxBets * 0.6)),
    })
  }
  const segments = Array.from(new Set(markets.map((market) => market.type)))
  segments.forEach((type) => {
    filters.push({
      id: `type:${type}`,
      label: humanize(type),
      predicate: (market) => market.type === type,
    })
  })
  return filters
}

function decorateMarkets(markets: MarketSummary[]): MarketCard[] {
  return markets.map((market, index) => {
    const rounds = market._count?.rounds ?? 0
    const bets = market._count?.bets ?? 0
    const activityScore = rounds * 0.6 + bets * 1.2 + (market.isActive ? 5 : 0)
    return {
      ...market,
      accent: ACCENT_POOL[index % ACCENT_POOL.length],
      activityScore,
      description: DESCRIPTIONS[market.type] ?? 'Provably fair attested market.',
    }
  })
}

export function MarketsPage() {
  const [markets, setMarkets] = useState<MarketCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      try {
        const data = await marketsService.getAll()
        setMarkets(decorateMarkets(data))
      } catch (err) {
        console.error(err)
        setError('Unable to load markets')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filters = useMemo(() => createFilters(markets), [markets])

  useEffect(() => {
    if (!filters.find((filter) => filter.id === activeFilter)) {
      setActiveFilter(filters[0]?.id ?? 'all')
    }
  }, [activeFilter, filters])

  const filteredMarkets = useMemo(() => {
    const filter = filters.find((item) => item.id === activeFilter) ?? filters[0]
    return markets.filter(filter?.predicate ?? (() => true))
  }, [activeFilter, filters, markets])

  if (loading) {
    return <div className="dashboard-panel">Loading markets…</div>
  }

  if (error) {
    return <div className="dashboard-panel">{error}</div>
  }

  return (
    <div className="dashboard-panel dashboard-panel-split">
      <div className="dashboard-panel-header">
        <div>
          <h1 className="dashboard-title">Markets</h1>
          <p className="dashboard-subtitle">Select a market to explore rounds, odds and analytics</p>
        </div>
      </div>

      <div className="dashboard-filter-bar">
        {filters.map((filter) => (
          <button
            key={filter.id}
            className={['dashboard-filter-pill', activeFilter === filter.id ? 'active' : ''].join(' ')}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="dashboard-market-grid">
        {filteredMarkets.map((market) => (
          <button
            key={market.id}
            className="card dashboard-market-card"
            style={{ background: market.accent }}
            onClick={() => navigate(`/app/markets/${market.id}`)}
          >
            <div className="dashboard-market-card-header">
              <span className="dashboard-market-chip">{humanize(market.type)}</span>
              <span className={`dashboard-market-status ${market.isActive ? 'active' : 'paused'}`}>
                {market.isActive ? 'Active' : 'Paused'}
              </span>
            </div>
            <h2 className="dashboard-market-title">{market.name}</h2>
            <p className="dashboard-market-description">{market.description}</p>
            <div className="dashboard-market-metrics">
              <div>
                <span className="dashboard-round-stat-label">Rounds</span>
                <strong>{market._count?.rounds ?? 0}</strong>
              </div>
              <div>
                <span className="dashboard-round-stat-label">Bets</span>
                <strong>{market._count?.bets ?? 0}</strong>
              </div>
              <div>
                <span className="dashboard-round-stat-label">Momentum</span>
                <div className="dashboard-round-trend-meter small">
                  <div style={{ width: `${Math.min(100, Math.max(12, market.activityScore * 6))}%` }} />
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
