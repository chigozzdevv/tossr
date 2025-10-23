import { Section, SectionHeader } from '../../../components/ui/section'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { roundsService, type Round } from '../../../services/rounds.service'

const ROUND_DURATION_MS = 5 * 60 * 1000 // 5 minutes default, will be synced from server

export function LiveRoundsSection() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLiveRounds()
    const interval = setInterval(fetchLiveRounds, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchLiveRounds = async () => {
    try {
      setError(null)
      const data = await roundsService.getActiveRounds()
      setRounds(data)
    } catch (error) {
      console.error('Failed to fetch live rounds:', error)
      setError('Failed to load active rounds')
    } finally {
      setLoading(false)
    }
  }

  const calculateTimeLeft = (round: Round): number => {
    if (round.status !== 'PREDICTING') return -1
    if (round.lockedAt) return -1

    const openedAt = new Date(round.openedAt).getTime()
    const now = Date.now()
    const elapsed = now - openedAt
    const remaining = ROUND_DURATION_MS - elapsed

    return Math.max(0, Math.floor(remaining / 1000))
  }

  const calculateTotalVolume = (round: Round): number => {
    if (!round.bets || round.bets.length === 0) return 0
    return round.bets.reduce((sum, bet) => sum + Number(bet.stake), 0)
  }

  const formatTimeLeft = (seconds: number) => {
    if (seconds < 0) return 'Locked'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const formatVolume = (amount: number) => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`
    if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`
    return amount.toString()
  }

  if (loading) {
    return (
      <Section id="live-rounds">
        <div className="container">
          <SectionHeader title="Live Rounds" sub="Join active betting rounds happening right now" />
          <div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--muted)' }}>
            Loading live rounds...
          </div>
        </div>
      </Section>
    )
  }

  if (error) {
    return (
      <Section id="live-rounds">
        <div className="container">
          <SectionHeader title="Live Rounds" sub="Join active betting rounds happening right now" />
          <div style={{ padding: '4rem 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
              {error}
            </p>
            <button onClick={fetchLiveRounds} className="btn btn-primary">
              Try Again
            </button>
          </div>
        </div>
      </Section>
    )
  }

  if (rounds.length === 0) {
    return (
      <Section id="live-rounds">
        <div className="container">
          <SectionHeader title="Live Rounds" sub="Join active betting rounds happening right now" />
          <div style={{ padding: '4rem 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
              No active rounds at the moment. New rounds start automatically!
            </p>
            <a href="#markets" className="btn btn-primary">
              Explore Markets
            </a>
          </div>
        </div>
      </Section>
    )
  }

  return (
    <Section id="live-rounds">
      <div className="container">
        <SectionHeader title="Live Rounds" sub="Join active betting rounds happening right now" />

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '1rem',
          marginTop: '1.5rem'
        }}>
          {rounds.map((round, idx) => (
            <motion.div
              key={round.id}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.28, delay: idx * 0.05 }}
              className="card"
              style={{
                padding: '1.25rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              whileHover={{
                y: -4,
                borderColor: 'color-mix(in oklab, var(--accent) 30%, var(--border))'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1rem'
              }}>
                <div>
                  <h3 style={{
                    margin: 0,
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    letterSpacing: '-0.01em'
                  }}>
                    {round.market.name}
                  </h3>
                  <p style={{
                    margin: '0.25rem 0 0 0',
                    fontSize: '0.85rem',
                    color: 'var(--muted)'
                  }}>
                    Round #{round.roundNumber}
                  </p>
                </div>

                <span className={round.status === 'PREDICTING' ? 'chip chip-accent' : 'chip'}>
                  {round.status === 'PREDICTING' ? 'Open' : 'Locked'}
                </span>
              </div>

              <div style={{
                display: 'grid',
                gap: '0.75rem',
                padding: '1rem 0',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                    Bets Placed
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                    {round._count?.bets || 0}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                    Total Volume
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {formatVolume(calculateTotalVolume(round))} SOL
                  </span>
                </div>

                {round.status === 'PREDICTING' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                      Time Left
                    </span>
                    <span style={{
                      fontWeight: 600,
                      color: calculateTimeLeft(round) < 60 ? '#f87171' : 'var(--text)'
                    }}>
                      {formatTimeLeft(calculateTimeLeft(round))}
                    </span>
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary"
                style={{
                  width: '100%',
                  marginTop: '1rem',
                  justifyContent: 'center'
                }}
                disabled={round.status === 'LOCKED'}
              >
                {round.status === 'PREDICTING' ? 'Place Bet' : 'Locked'}
              </button>
            </motion.div>
          ))}
        </div>

        <div style={{
          marginTop: '2rem',
          textAlign: 'center'
        }}>
          <a href="/rounds" className="chip" style={{ padding: '0.5rem 1rem' }}>
            View All Rounds →
          </a>
        </div>
      </div>
    </Section>
  )
}
