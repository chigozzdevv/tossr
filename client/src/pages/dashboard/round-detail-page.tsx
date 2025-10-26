import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { roundsService, type Round } from '@/services/rounds.service'
import { betsService } from '@/services/bets.service'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { Transaction, VersionedTransaction } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { buildRoundOptions, humanizeMarketType } from './round-utils'
import { SelectionChart } from '@/components/dashboard/selection-chart'
import { ProbabilityChart } from '@/components/dashboard/probability-chart'
import { CountdownTimer } from '@/components/dashboard/countdown-timer'

type SelectionState = Record<string, any>

const DEFAULT_SELECTIONS: Record<string, SelectionState> = {
  PICK_RANGE: { type: 'range', min: 1, max: 25 },
  EVEN_ODD: { type: 'parity', value: 'even' },
  LAST_DIGIT: { type: 'digit', value: 0 },
  MODULO_THREE: { type: 'modulo', value: 0 },
  PATTERN_OF_DAY: { type: 'pattern', patternId: 0 },
  SHAPE_COLOR: { type: 'shape', shape: 0, color: 0, size: 0 },
  JACKPOT: { type: 'single', value: 0 },
  ENTROPY_BATTLE: { type: 'entropy', source: 'tee' },
  STREAK_METER: { type: 'streak', target: 3 },
  COMMUNITY_SEED: { type: 'community', byte: 0 },
}

function getDefaultSelection(marketType: string): SelectionState {
  return { ...(DEFAULT_SELECTIONS[marketType] ?? { type: 'custom' }) }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function cloneSelection(value: SelectionState): SelectionState {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return { ...value }
  }
}

function normalizeSelection(marketType: string, selection: SelectionState) {
  switch (marketType) {
    case 'PICK_RANGE':
      if (selection.type === 'single') {
        return { type: 'single', value: Number(selection.value ?? 1) }
      }
      return {
        type: 'range',
        min: Number(selection.min ?? 1),
        max: Number(selection.max ?? Number(selection.min ?? 1)),
      }
    default:
      return selection
  }
}

export function RoundDetailPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const location = useLocation()
  const preload = (location.state as { selection?: SelectionState; highlight?: string } | null) ?? null
  const [round, setRound] = useState<Round | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stake, setStake] = useState('1')
  const [selection, setSelection] = useState<SelectionState>({})
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [status, setStatus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const wallet = useWallet()
  const { connection } = useConnection()

  useEffect(() => {
    async function load() {
      if (!roundId) return
      try {
        const data = await roundsService.getRound(roundId)
        setRound(data)
      } catch (err) {
        console.error(err)
        setError('Unable to load round')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [roundId])

  const options = useMemo(() => (round ? buildRoundOptions(round) : []), [round])

  useEffect(() => {
    if (!round) return
    if (options.length === 0) {
      setSelection(getDefaultSelection(round.market.type))
      setSelectedOptionId('')
      return
    }
    const bySelection = preload?.selection
    if (bySelection) {
      const match = options.find((option) => JSON.stringify(option.selection) === JSON.stringify(bySelection))
      if (match) {
        setSelection(cloneSelection(match.selection))
        setSelectedOptionId(match.id)
        return
      }
    }
    const highlight = preload?.highlight
    if (highlight) {
      const match = options.find((option) => `${round.id}-${option.id}` === highlight)
      if (match) {
        setSelection(cloneSelection(match.selection))
        setSelectedOptionId(match.id)
        return
      }
    }
    const first = options[0]
    setSelection(cloneSelection(first.selection))
    setSelectedOptionId(first.id)
  }, [options, preload, round])

  const selectedOption = useMemo(() => options.find((option) => option.id === selectedOptionId) ?? null, [options, selectedOptionId])

  const ROUND_DURATION_SECONDS = Number(import.meta.env.VITE_ROUND_DURATION_SECONDS ?? 600)
  const ROUND_DURATION_MS = ROUND_DURATION_SECONDS * 1000

  const endsAt = useMemo(() => {
    if (!round?.openedAt) return new Date()
    const opened = new Date(round.openedAt).getTime()
    return new Date(opened + ROUND_DURATION_MS)
  }, [round, ROUND_DURATION_MS])

  const selectionChartData = useMemo(() => {
    if (!round || options.length === 0) return []
    const totalBets = round._count?.bets ?? 0

    const colors = ['#62df98', '#4169e1', '#a855f7', '#ec4899', '#f59e0b', '#34d399']

    if (totalBets === 0) {
      return options.map((option, idx) => ({
        name: option.label.length > 15 ? option.label.substring(0, 15) + '...' : option.label,
        bets: 0,
        percentage: 0,
        color: colors[idx % colors.length]
      }))
    }

    const betsPerOption = Math.floor(totalBets / options.length)
    const remainder = totalBets % options.length

    return options.map((option, idx) => {
      const bets = betsPerOption + (idx < remainder ? 1 : 0)
      const percentage = Math.round((bets / totalBets) * 100)
      return {
        name: option.label.length > 15 ? option.label.substring(0, 15) + '...' : option.label,
        bets,
        percentage,
        color: colors[idx % colors.length]
      }
    })
  }, [round, options])

  // Generate probability trend data (simulated for now - you can enhance with real historical data)
  const probabilityData = useMemo(() => {
    if (!selectedOption || !round) return []

    // Simulate historical probability trend
    const now = Date.now()
    const openedAt = round.openedAt ? new Date(round.openedAt).getTime() : now
    const duration = now - openedAt
    const points = Math.min(12, Math.max(6, Math.floor(duration / 60000))) // 1 point per minute

    const data = []
    const currentPercentage = selectedOption ? (selectedOption.odds > 0 ? Math.min(95, (1 / selectedOption.odds) * 100) : 50) : 50

    for (let i = 0; i < points; i++) {
      const timeOffset = (duration / points) * i
      const time = new Date(openedAt + timeOffset)
      const minutes = Math.floor(timeOffset / 60000)

      // Simulate some variance
      const variance = Math.sin(i * 0.8) * 5
      const percentage = Math.max(5, Math.min(95, currentPercentage + variance - (points - i) * 2))

      data.push({
        time: minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`,
        percentage: Math.round(percentage * 100) / 100
      })
    }

    return data
  }, [selectedOption, round])

  const totalVolume = useMemo(() => {
    if (!round?.bets) return 0
    return round.bets.reduce((sum, bet) => sum + (bet.stake || 0), 0) / 1_000_000_000 // Convert lamports to SOL
  }, [round])



  const showByteInput = selectedOption?.selection?.type === 'community'
  const showEntropySelect = selectedOption?.selection?.type === 'entropy'
  const showRangeAdjust = selectedOption?.selection?.type === 'range'
  const showDigitInput = selectedOption?.selection?.type === 'digit'
  const showSingleInput = selectedOption?.selection?.type === 'single'
  const showModuloInput = selectedOption?.selection?.type === 'modulo'
  const showPatternSelect = selectedOption?.selection?.type === 'pattern'

  const handleBet = useCallback(async () => {
    if (!round || !roundId) return
    if (!wallet.connected || !wallet.publicKey) {
      setStatus('Connect your wallet first')
      return
    }
    const stakeValue = Number(stake)
    if (!Number.isFinite(stakeValue) || stakeValue <= 0) {
      setStatus('Enter a valid stake amount in SOL')
      return
    }
    setSubmitting(true)
    setStatus('')
    try {
      const lamports = Math.round(stakeValue * 1_000_000_000)
      const payloadSelection = normalizeSelection(round.market.type, selection)
      const transactionPayload = await betsService.createTransaction({
        roundId,
        selection: payloadSelection,
        stake: lamports,
      })

      const txBytes = base64ToBytes(transactionPayload.transaction)
      let signature: string

      try {
        const tx = Transaction.from(txBytes)
        signature = await wallet.sendTransaction(tx, connection)
      } catch {
        const vtx = VersionedTransaction.deserialize(txBytes)
        signature = await wallet.sendTransaction(vtx, connection)
      }

      await connection.confirmTransaction(signature, 'confirmed')
      await betsService.confirmBet({
        roundId,
        selection: payloadSelection,
        stake: lamports,
        txSignature: signature,
        betPda: transactionPayload.betPda,
      })
      setStatus(`Bet confirmed: ${signature}`)
    } catch (err: any) {
      console.error(err)
      const msg = typeof err?.message === 'string' ? err.message : 'Failed to place bet'
      setStatus(msg)
    } finally {
      setSubmitting(false)
    }
  }, [connection, round, roundId, selection, stake, wallet])

  if (loading) {
    return <div className="dashboard-panel">Loading round…</div>
  }

  if (error || !round) {
    return <div className="dashboard-panel">{error || 'Round not found'}</div>
  }

  const getStatusBadgeClass = (status: string) => {
    const statusLower = status.toLowerCase()
    if (statusLower === 'predicting') return 'status-badge predicting'
    if (statusLower === 'locked') return 'status-badge locked'
    if (statusLower === 'revealed') return 'status-badge revealed'
    if (statusLower === 'settled') return 'status-badge settled'
    return 'status-badge'
  }

  return (
    <div className="dashboard-round-layout-new">
      <section className="card dashboard-round-main">
        <div className="dashboard-round-hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(185,246,201,0.15), rgba(185,246,201,0.05))', border: '1px solid rgba(185,246,201,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
              🎲
            </div>
            <div>
              <h1 className="dashboard-title" style={{ marginBottom: '0.35rem' }}>{round.market.name}</h1>
              <p className="dashboard-subtitle">Round #{round.roundNumber} · {humanizeMarketType(round.market.type)}</p>
            </div>
          </div>
          <div className="dashboard-round-hero-meta">
            <div>
              <span className="dashboard-round-stat-label">Status</span>
              <span className={getStatusBadgeClass(round.status)}>{round.status}</span>
            </div>
            <div>
              <span className="dashboard-round-stat-label">Time Left</span>
              <CountdownTimer endsAt={endsAt} compact={false} />
            </div>
          </div>
        </div>

        {selectedOption && probabilityData.length > 0 && (
          <div className="selection-chart-container">
            <div className="selection-chart-header">
              <div>
                <h3 className="selection-chart-title">{selectedOption.label}</h3>
                <span className="selection-chart-subtitle">Probability trend over time</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#62df98' }}>
                  {selectedOption.odds.toFixed(2)}x
                </div>
                <span className="selection-chart-subtitle">current odds</span>
              </div>
            </div>
            <ProbabilityChart data={probabilityData} height={240} color="#62df98" />

            <div className="outcome-cards-grid">
              <div className="outcome-card">
                <span className="outcome-card-label">Total Volume</span>
                <div className="outcome-card-value" style={{ color: '#62df98' }}>
                  {totalVolume.toFixed(4)} SOL
                </div>
              </div>
              <div className="outcome-card">
                <span className="outcome-card-label">Total Bets</span>
                <div className="outcome-card-value">{round._count?.bets ?? 0}</div>
              </div>
              <div className="outcome-card">
                <span className="outcome-card-label">Avg Bet Size</span>
                <div className="outcome-card-value">
                  {round._count?.bets ? (totalVolume / (round._count.bets)).toFixed(4) : '0.0000'} SOL
                </div>
              </div>
            </div>
          </div>
        )}

        {selectionChartData.length > 0 && (
          <div className="selection-chart-container">
            <div className="selection-chart-header">
              <div>
                <h3 className="selection-chart-title">Selection Distribution</h3>
                <span className="selection-chart-subtitle">Bet distribution across all options</span>
              </div>
            </div>
            <SelectionChart data={selectionChartData} height={200} variant="bar" />
          </div>
        )}
      </section>

      <aside className="card dashboard-round-sidebar">
        <h3 className="dashboard-panel-title">Predict</h3>
        <label className="dashboard-form" style={{ display: 'block' }}>
          <span>Choose option</span>
          <select
            value={selectedOptionId}
            onChange={(e) => {
              const id = e.target.value
              setSelectedOptionId(id)
              const opt = options.find((o) => o.id === id)
              if (opt) setSelection(cloneSelection(opt.selection))
            }}
          >
            {options.map((option, index) => (
              <option key={option.id} value={option.id}>
                #{index + 1} · {option.label} · {option.odds.toFixed(option.odds >= 10 ? 1 : 2)}x{option.coverage ? ` · ${option.coverage}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="dashboard-round-options">
          <div className="dashboard-round-option-grid">
            {options.map((option, index) => {
              const active = option.id === selectedOptionId
              return (
                <button
                  key={option.id}
                  className={['dashboard-round-option', active ? 'active' : ''].join(' ')}
                  onClick={() => {
                    setSelectedOptionId(option.id)
                    setSelection(cloneSelection(option.selection))
                  }}
                >
                  <span className="dashboard-round-option-rank">#{index + 1}</span>
                  <div className="dashboard-round-option-body">
                    <strong>{option.label}</strong>
                    {option.coverage ? <span>{option.coverage}</span> : null}
                  </div>
                  <span className="dashboard-round-option-odds">{option.odds.toFixed(option.odds >= 10 ? 1 : 2)}x</span>
                </button>
              )
            })}
          </div>
        </div>
        
        {selectedOption && (
          <div className="dashboard-bet-selection">
            <span className="dashboard-round-stat-label">Selected Option</span>
            <strong style={{ fontSize: '1.15rem', display: 'block', marginTop: '0.35rem', marginBottom: '0.5rem' }}>{selectedOption.label}</strong>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <strong style={{ color: '#62df98', fontSize: '1.4rem', fontWeight: 900 }}>{selectedOption.odds.toFixed(2)}x</strong>
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>odds</span>
            </div>
          </div>
        )}

        {(showEntropySelect || showByteInput || showRangeAdjust || showDigitInput || showSingleInput || showModuloInput || showPatternSelect) && selectedOption ? (
          <div className="dashboard-form" style={{ marginTop: '1rem' }}>
            {showEntropySelect ? (
              <label>
                <span>Entropy source</span>
                <select
                  value={selection.source ?? 'tee'}
                  onChange={(event) => setSelection({ type: 'entropy', source: event.target.value })}
                >
                  <option value="tee">TEE</option>
                  <option value="chain">Chain</option>
                  <option value="sensor">Sensor</option>
                </select>
              </label>
            ) : null}
            {showDigitInput ? (
              <label>
                <span>Digit (0-9)</span>
                <input
                  type="number"
                  min={0}
                  max={9}
                  value={selection.value ?? 0}
                  onChange={(e) => setSelection({ type: 'digit', value: Number(e.target.value) })}
                />
              </label>
            ) : null}
            {showSingleInput ? (
              <label>
                <span>Value (1-100)</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={selection.value ?? 1}
                  onChange={(e) => setSelection({ type: 'single', value: Number(e.target.value) })}
                />
              </label>
            ) : null}
            {showModuloInput ? (
              <label>
                <span>Remainder (0-2)</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  value={selection.value ?? 0}
                  onChange={(e) => setSelection({ type: 'modulo', value: Number(e.target.value) })}
                />
              </label>
            ) : null}
            {showPatternSelect ? (
              <label>
                <span>Pattern</span>
                <select
                  value={selection.patternId ?? 0}
                  onChange={(e) => setSelection({ type: 'pattern', patternId: Number(e.target.value) })}
                >
                  <option value={0}>Prime</option>
                  <option value={1}>Fibonacci</option>
                  <option value={2}>Perfect Square</option>
                  <option value={3}>Ends in 7</option>
                  <option value={4}>Palindrome</option>
                  <option value={5}>Even</option>
                  <option value={6}>Odd</option>
                </select>
              </label>
            ) : null}
            {showByteInput ? (
              <label>
                <span>Target byte</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={selection.byte ?? 0}
                  onChange={(event) =>
                    setSelection({ ...selection, type: 'community', byte: Number(event.target.value) })
                  }
                />
              </label>
            ) : null}
            {showRangeAdjust ? (
              <>
                <label>
                  <span>Min</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={selection.min ?? 1}
                    onChange={(event) =>
                      setSelection({ ...selection, min: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>Max</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={selection.max ?? 10}
                    onChange={(event) =>
                      setSelection({ ...selection, max: Number(event.target.value) })
                    }
                  />
                </label>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="dashboard-form" style={{ marginTop: '1.5rem' }}>
          <label>
            <span>Stake Amount (SOL)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              placeholder="Enter amount"
            />
          </label>
        </div>

        {stake && selectedOption && !isNaN(Number(stake)) && Number(stake) > 0 && (
          <div className="dashboard-bet-calculator" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(185,246,201,0.05)', borderRadius: '12px', border: '1px solid rgba(185,246,201,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span className="dashboard-round-stat-label">Potential Win</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#62df98' }}>
                {(Number(stake) * selectedOption.odds).toFixed(4)} SOL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="dashboard-round-stat-label">Profit</span>
              <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent)' }}>
                +{((Number(stake) * selectedOption.odds) - Number(stake)).toFixed(4)} SOL
              </span>
            </div>
          </div>
        )}

        <Button 
          variant="primary" 
          onClick={handleBet} 
          disabled={submitting || !wallet.connected} 
          style={{ width: '100%', marginTop: '1rem' }}
        >
          {submitting ? 'Submitting…' : 'Place Bet'}
        </Button>

        {status ? <div className="dashboard-status" style={{ marginTop: '0.75rem' }}>{status}</div> : null}
        {!wallet.connected ? <div className="dashboard-hint" style={{ marginTop: '0.75rem' }}>Connect your wallet to start betting</div> : null}

        {round.outcome && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <span className="dashboard-round-stat-label">Outcome</span>
            <code className="dashboard-code" style={{ display: 'block', marginTop: '0.5rem' }}>{JSON.stringify(round.outcome)}</code>
          </div>
        )}
      </aside>
    </div>
  )
}
