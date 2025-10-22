import { Card } from '../../../components/ui/card'
import { Section, SectionHeader } from '../../../components/ui/section'
import { motion } from 'framer-motion'

export function HowItWorksSection() {
  return (
    <Section id="how-it-works">
      <div className="container">
        <SectionHeader title="How it works" sub="Three simple steps to place a verifiable bet" />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35 }} style={{ flex: '1 1 260px' }}>
            <Card>
              <h3 style={{ marginTop: 0 }}>1. Choose a market</h3>
              <p className="section-sub">Browse open rounds and verify the rules upfront.</p>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: .08 }} style={{ flex: '1 1 260px' }}>
            <Card>
              <h3 style={{ marginTop: 0 }}>2. Place your stake</h3>
              <p className="section-sub">Funds lock in a program escrow until resolution.</p>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: .16 }} style={{ flex: '1 1 260px' }}>
            <Card>
              <h3 style={{ marginTop: 0 }}>3. Settle on-chain</h3>
              <p className="section-sub">Randomness is attested; winnings distribute automatically.</p>
            </Card>
          </motion.div>
        </div>
      </div>
    </Section>
  )
}
