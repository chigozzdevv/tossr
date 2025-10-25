import { Card } from '@/components/ui/card'
import { Section, SectionHeader } from '@/components/ui/section'
import { motion } from 'framer-motion'

const steps = [
  { key: 'open', title: 'Open Round' },
  { key: 'delegate', title: 'Delegate' },
  { key: 'bet', title: 'Place Bets' },
  { key: 'lock', title: 'Lock' },
  { key: 'generate', title: 'Generate' },
  { key: 'commit', title: 'Commit' },
  { key: 'reveal', title: 'Reveal' },
  { key: 'settle', title: 'Settle' },
]

const phases = [
  {
    key: 'prepare',
    title: 'Round Setup',
    sub: 'Initialize round and collect bets',
    items: [
      'New round opens automatically',
      'Delegated to MagicBlock ER for speed',
      'Players place bets with tokens',
      'Round locks when timer expires'
    ],
    chips: ['Solana', 'MagicBlock ER']
  },
  {
    key: 'prove',
    title: 'Verifiable Generation',
    sub: 'TEE generates provably fair outcome',
    items: [
      'TEE derives outcome from chain data',
      'SHA256 commitment hash created',
      'Cryptographic signature generated',
      'Hash committed on-chain (hidden)'
    ],
    chips: ['TEE Attestation', 'Coming Soon: DCAP']
  },
  {
    key: 'settle',
    title: 'Settlement',
    sub: 'Reveal, verify and payout',
    items: [
      'TEE reveals outcome with proof',
      'Smart contract verifies commitment',
      'Each bet evaluated against outcome',
      'Winners paid from vault to wallet',
      'Final state synced to Solana base'
    ],
    chips: ['Verify', 'Tossr Engine']
  },
]

export function HowItWorksSection() {
  return (
    <Section id="how-it-works">
      <div className="container">
        <SectionHeader title="How it works" sub="Provably fair betting powered by MagicBlock TEE and Solana" />
        <div className="how-v3">
          <div className="process-rail">
            <div className="rail-line" aria-hidden />
            <div className="rail-nodes">
              {steps.map((s, i) => (
                <div key={s.key} className="rail-node">
                  <span className="dot"><span className="pulse" /></span>
                  <span className="label">{i + 1}. {s.title}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="phase-grid">
            {phases.map((p, idx) => (
              <motion.div key={p.key} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.28, delay: idx * 0.05 }}>
                <Card className="phase-card">
                  <div className="phase-head">
                    <strong>{p.title}</strong>
                    <div className="chip-grid">
                      {p.chips.map((c, i) => (
                        <span key={i} className={c.includes('MagicBlock') ? 'chip chip-accent' : 'chip'}>{c}</span>
                      ))}
                    </div>
                  </div>
                  <div className="phase-sub meta">{p.sub}</div>
                  <ul className="phase-list">
                    {p.items.map((it, i) => (<li key={i}>{it}</li>))}
                  </ul>
                </Card>
              </motion.div>
            ))}
          </div>
          <div className="flow-actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            <a href="https://docs.magicblock.gg/TrustedExecutionLayer/Overview" target="_blank" rel="noopener noreferrer" className="chip chip-accent">Learn about TEE</a>
            <a href="#markets" className="chip">Try it now</a>
          </div>
        </div>
      </div>
    </Section>
  )
}
