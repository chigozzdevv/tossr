import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { roundsService, type Round } from '@/services/rounds.service'
import { betsService } from '@/services/bets.service'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { Transaction, VersionedTransaction } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { buildRoundOptions, humanizeMarketType } from './round-utils'

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

  const analytics = useMemo(() => {
    if (!round) return []
    return [
      { label: 'Status', value: round.status },
      { label: 'Opened', value: round.openedAt ? new Date(round.openedAt).toLocaleString() : '—' },
      { label: 'Locked', value: round.lockedAt ? new Date(round.lockedAt).toLocaleString() : '—' },
      { label: 'Bets', value: round._count?.bets ?? 0 },
      { label: 'Market', value: round.market.name },
      { label: 'Type', value: round.market.type.replace(/_/g, ' ') },
    ]
  }, [round])

  const trendFeed = useMemo(() => {
    if (!round || options.length === 0) return [] as Array<{ id: string; user: string; message: string; timeAgo: string; emphasis: number }>
    const sample = options.slice(0, 6)
    const baseTime = Date.now()
    return sample.map((option, index) => {
      const heat = Math.min(1, ((round._count?.bets ?? 1) + index * 0.5) / (index + 5))
      const sol = (Math.abs(Math.cos(baseTime / (index + 3))) * 6 + 0.4).toFixed(2)
      return {
        id: `${option.id}-${index}`,
        user: `bettor_${(option.id.length * 11 + index) % 97}`,
        message: `${option.label} backed with ${sol} SOL stake`,
        timeAgo: `${index * 2 + 1}m ago`,
        emphasis: heat,
      }
    })
  }, [options, round])

  const showByteInput = selectedOption?.selection?.type === 'community'
  const showEntropySelect = selectedOption?.selection?.type === 'entropy'
  const showRangeAdjust = selectedOption?.selection?.type === 'range'

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
      } catch (legacyError) {
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

  return (
    <div className="dashboard-round-layout">
      <section className="card dashboard-round-analytics">
        <div className="dashboard-round-hero">
          <div>
            <span className="dashboard-market-chip large">{humanizeMarketType(round.market.type)}</span>
            <h1 className="dashboard-title">Round #{round.roundNumber}</h1>
            <p className="dashboard-subtitle">{round.market.name}</p>
          </div>
          <div className="dashboard-round-hero-meta">
            <div>
              <span className="dashboard-round-stat-label">Status</span>
              <strong>{round.status}</strong>
            </div>
            <div>
              <span className="dashboard-round-stat-label">Bets</span>
              <strong>{round._count?.bets ?? 0}</strong>
            </div>
            <div>
              <span className="dashboard-round-stat-label">Opened</span>
              <strong>{round.openedAt ? new Date(round.openedAt).toLocaleTimeString() : '—'}</strong>
            </div>
          </div>
        </div>

        <div className="dashboard-analytics-grid">
          {analytics.map((item) => (
            <div key={item.label} className="dashboard-analytic">
              <span className="dashboard-analytic-label">{item.label}</span>
              <strong className="dashboard-analytic-value">{item.value}</strong>
            </div>
          ))}
        </div>

        <div className="dashboard-round-options">
          <div className="dashboard-round-options-header">
            <h2>Pick your lane</h2>
            <span>{options.length} selections · live odds</span>
          </div>
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

        {(showEntropySelect || showByteInput || showRangeAdjust) && selectedOption ? (
          <div className="dashboard-round-adjustments">
            <h3>Fine tune</h3>
            <div className="dashboard-round-adjust-grid">
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
          </div>
        ) : null}

        {round.outcome ? (
          <div className="dashboard-outcome">
            <span>Outcome</span>
            <code className="dashboard-code">{JSON.stringify(round.outcome)}</code>
          </div>
        ) : null}

        <footer className="dashboard-round-stake">
          <div className="dashboard-round-stake-info">
            <span>Stake (SOL)</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={stake}
              onChange={(event) => setStake(event.target.value)}
            />
          </div>
          <Button variant="primary" onClick={handleBet} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Place bet'}
          </Button>
        </footer>
        {status ? <div className="dashboard-status">{status}</div> : null}
        {!wallet.connected ? <div className="dashboard-hint">Connect wallet to enable betting.</div> : null}
        {wallet.publicKey ? (
          <div className="dashboard-hint">Wallet: {wallet.publicKey.toBase58()}</div>
        ) : null}
      </section>

      <aside className="card dashboard-round-feed">
        <div className="dashboard-round-feed-header">
          <h2>Live trendline</h2>
          <span>{trendFeed.length} signals</span>
        </div>
        <div className="dashboard-round-feed-stream">
          {trendFeed.map((item) => (
            <div key={item.id} className="dashboard-round-feed-bubble">
              <div className="dashboard-round-feed-meta">
                <span>@{item.user}</span>
                <span>{item.timeAgo}</span>
              </div>
              <p>{item.message}</p>
              <div className="dashboard-round-feed-meter">
                <div style={{ width: `${Math.max(14, item.emphasis * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
