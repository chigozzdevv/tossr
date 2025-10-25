import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { roundsService, type Round } from '@/services/rounds.service'
import { buildRoundOptions, humanizeMarketType } from './round-utils'

type RoundSelectionEntry = {
  id: string
  round: Round
  label: string
  odds: number
  coverage?: string
  accent: string
  timeLeftLabel: string
  timeRatio: number
  trend: number
  bets: number
  selection: any
}

const ROUND_DURATION_SECONDS = Number(import.meta.env.VITE_ROUND_DURATION_SECONDS ?? 300)
const ROUND_DURATION_MS = ROUND_DURATION_SECONDS * 1000
const ACCENTS = [
  'linear-gradient(135deg, rgba(185,246,201,0.35), rgba(98,223,152,0.2))',
  'linear-gradient(135deg, rgba(138,180,248,0.4), rgba(65,105,225,0.25))',
  'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(109,40,217,0.2))',
  'linear-gradient(135deg, rgba(244,114,182,0.4), rgba(236,72,153,0.25))',
  'linear-gradient(135deg, rgba(251,191,36,0.35), rgba(249,115,22,0.25))',
]

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function deriveTimeMeta(openedAt?: string) {
  if (!openedAt) {
    return { label: 'Pending', ratio: 0 }
  }
  const opened = new Date(openedAt).getTime()
  const now = Date.now()
  const elapsed = clamp(now - opened, 0, ROUND_DURATION_MS)
  const ratio = ROUND_DURATION_MS === 0 ? 0 : elapsed / ROUND_DURATION_MS
  const remaining = opened + ROUND_DURATION_MS - now
  if (remaining <= 0) {
    return { label: 'Closing', ratio: 1 }
  }
  const minutes = Math.floor(remaining / 1000 / 60)
  const seconds = Math.floor((remaining / 1000) % 60)
  return { label: `${minutes}m ${seconds.toString().padStart(2, '0')}s`, ratio }
}

function buildSelectionEntries(round: Round): RoundSelectionEntry[] {
  const options = buildRoundOptions(round)
  const { label: timeLeftLabel, ratio: timeRatio } = deriveTimeMeta(round.openedAt)
  const bets = round._count?.bets ?? 0

  return options.map((option, idx) => ({
    id: `${round.id}-${option.id}`,
    round,
    label: option.label,
    odds: option.odds,
    coverage: option.coverage,
    accent: ACCENTS[idx % ACCENTS.length],
    timeLeftLabel,
    timeRatio,
    trend: clamp((bets / 10) + (1 / Math.max(option.odds, 1)) + (1 - timeRatio), 0, 3),
    bets,
    selection: option.selection,
  }))
}

type RoundFilter = {
  id: string
  label: string
  predicate: (entry: RoundSelectionEntry) => boolean
}

function createFilters(entries: RoundSelectionEntry[]): RoundFilter[] {
  const filters: RoundFilter[] = [{ id: 'all', label: 'All', predicate: () => true }]
  const maxBets = entries.reduce((max, entry) => Math.max(max, entry.bets), 0)
  if (maxBets > 0) {
    filters.push({
      id: 'popular',
      label: 'Popular',
      predicate: (entry) => entry.bets >= Math.max(2, Math.floor(maxBets * 0.6)),
    })
  }
  const closingSoonThreshold = 0.75
  if (entries.some((entry) => entry.timeRatio >= closingSoonThreshold)) {
    filters.push({
      id: 'closing',
      label: 'Closing Soon',
      predicate: (entry) => entry.timeRatio >= closingSoonThreshold,
    })
  }
  const highOddsThreshold = entries.reduce((sum, entry) => sum + entry.odds, 0) / Math.max(entries.length, 1)
  if (entries.some((entry) => entry.odds >= highOddsThreshold)) {
    filters.push({
      id: 'high-odds',
      label: 'High Odds',
      predicate: (entry) => entry.odds >= highOddsThreshold,
    })
  }
  const types = Array.from(new Set(entries.map((entry) => entry.round.market.type)))
  types.forEach((type) => {
    filters.push({
      id: `type:${type}`,
      label: humanizeMarketType(type),
      predicate: (entry) => entry.round.market.type === type,
    })
  })
  return filters
}

export function RoundsPage() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const navigate = useNavigate()

  const fetchRounds = useCallback(async () => {
    try {
      setError('')
      const data = await roundsService.getActiveRounds()
      setRounds(data)
    } catch (err) {
      console.error(err)
      setError('Unable to load rounds')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRounds()
    const interval = window.setInterval(fetchRounds, 15000)
    return () => window.clearInterval(interval)
  }, [fetchRounds])

  const entries = useMemo(() => {
    const active = rounds.filter((round) => round.status === 'PREDICTING')
    return active.flatMap((round) => buildSelectionEntries(round))
  }, [rounds])

  const filters = useMemo(() => createFilters(entries), [entries])

  useEffect(() => {
    if (!filters.find((filter) => filter.id === activeFilter)) {
      setActiveFilter(filters[0]?.id ?? 'all')
    }
  }, [activeFilter, filters])

  const filteredEntries = useMemo(() => {
    const selected = filters.find((filter) => filter.id === activeFilter) ?? filters[0]
    return entries.filter(selected?.predicate ?? (() => true))
  }, [activeFilter, entries, filters])

  if (loading) {
    return <div className="dashboard-panel">Loading live rounds…</div>
  }

  if (error) {
    return (
      <div className="dashboard-panel">
        <p>{error}</p>
        <button className="btn" onClick={fetchRounds}>Retry</button>
      </div>
    )
  }

  return (
    <div className="dashboard-panel dashboard-panel-split">
      <div className="dashboard-panel-header">
        <div>
          <h1 className="dashboard-title">Live Bets</h1>
          <p className="dashboard-subtitle">Dive into active rounds and pick your edge</p>
        </div>
        <div className="dashboard-filter-tools">
          <button className="btn" onClick={fetchRounds}>Refresh</button>
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

      {filteredEntries.length === 0 ? (
        <div className="dashboard-empty">No bets match this filter right now.</div>
      ) : (
        <div className="dashboard-round-grid">
          {filteredEntries.map((entry) => (
            <button
              key={entry.id}
              className="card dashboard-round-card"
              style={{ background: entry.accent }}
              onClick={() => navigate(`/app/rounds/${entry.round.id}`, { state: { selection: entry.selection, highlight: entry.id } })}
            >
              <div className="dashboard-round-card-header">
                <span className="dashboard-round-chip">{humanizeMarketType(entry.round.market.type)}</span>
                <span className="dashboard-round-timer">Ends in {entry.timeLeftLabel}</span>
              </div>
              <h2 className="dashboard-round-card-title">{entry.label}</h2>
              <p className="dashboard-round-meta">Round #{entry.round.roundNumber} · {entry.round.market.name}</p>
              <div className="dashboard-round-stats">
                <div>
                  <span className="dashboard-round-stat-label">Odds</span>
                  <strong className="dashboard-round-odds">{entry.odds.toFixed(entry.odds >= 10 ? 1 : 2)}x</strong>
                  {entry.coverage ? <span className="dashboard-round-coverage">{entry.coverage} coverage</span> : null}
                </div>
                <div className="dashboard-round-trend">
                  <span className="dashboard-round-stat-label">Trend</span>
                  <div className="dashboard-round-trend-meter">
                    <div style={{ width: `${clamp((entry.trend / 3) * 100, 8, 100)}%` }} />
                  </div>
                  <span className="dashboard-round-bets">{entry.bets} bets live</span>
                </div>
              </div>
              <div className="dashboard-round-progress">
                <div className="dashboard-round-progress-bar" style={{ width: `${entry.timeRatio * 100}%` }} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
