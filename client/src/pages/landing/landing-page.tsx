import { Navbar } from '../../components/ui/navbar'
import { Hero } from './sections/hero'
import { HowItWorksSection } from './sections/how-it-works'
import { MarketsSection } from './sections/markets'
import { LiveRoundsSection } from './sections/live-rounds'
import { FaqSection } from './sections/faq'
import { Section, SectionDivider } from '../../components/ui/section'
import { Button } from '../../components/ui/button'

export function LandingPage() {
  return (
    <div>
      <Navbar />
      <main>
        <Hero />
        <SectionDivider />
        <HowItWorksSection />
        <SectionDivider />
        <MarketsSection />
        <SectionDivider />
        <LiveRoundsSection />
        <SectionDivider />
        <FaqSection />
        <SectionDivider />
        <Section id="get-started">
          <div className="container" style={{ textAlign: 'center', padding: '4rem 0' }}>
            <h2 className="section-title" style={{ fontSize: '2.2rem', marginBottom: '1rem' }}>
              Ready to bet on attested randomness?
            </h2>
            <p className="section-sub" style={{ maxWidth: '560px', margin: '0 auto 2rem', fontSize: '1.05rem' }}>
              Launch Tossr, connect your wallet, and play SOL markets secured by MagicBlock PER + VRF proofs.
            </p>
            <div className="row row-center" style={{ marginTop: '2.25rem', gap: '1rem' }}>
              <Button variant="primary" style={{ padding: '0.95rem 2.4rem', fontSize: '1rem' }}>
                Connect Wallet
              </Button>
              <a className="btn" href="#markets" style={{ padding: '0.95rem 2.4rem' }}>
                Explore Markets
              </a>
            </div>
          </div>
        </Section>
      </main>
      <footer style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        marginTop: '3rem'
      }}>
        <div className="container" style={{
          padding: '2.5rem 0',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img src="/logo-tossr.svg" alt="Tossr" style={{ height: '28px', width: '28px' }} />
            <div>
              <strong style={{ fontSize: '1rem', letterSpacing: '0.02em' }}>tossr</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>MagicBlock PER + VRF on Solana</div>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
            <a href="#how-it-works" style={{ color: 'var(--muted)' }}>How it works</a>
            <a href="#markets" style={{ color: 'var(--muted)' }}>Markets</a>
            <a href="#live-rounds" style={{ color: 'var(--muted)' }}>Rounds</a>
            <a href="#faq" style={{ color: 'var(--muted)' }}>FAQ</a>
          </nav>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
            <a href="/terms" style={{ color: 'var(--muted)' }}>Terms</a>
            <a href="/privacy" style={{ color: 'var(--muted)' }}>Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
