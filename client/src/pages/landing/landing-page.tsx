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
            <h2 className="section-title" style={{ fontSize: '2rem', marginBottom: '1rem' }}>
              Ready to experience provably fair betting?
            </h2>
            <p className="section-sub" style={{ maxWidth: '600px', margin: '0 auto 2rem', fontSize: '1.05rem' }}>
              Connect your wallet and start betting on verifiable outcomes powered by MagicBlock TEE and Solana.
            </p>
            <div className="row row-center" style={{ marginTop: '2rem', gap: '1rem' }}>
              <Button variant="primary" style={{ padding: '0.9rem 2rem', fontSize: '1rem' }}>
                Connect Wallet
              </Button>
              <a className="btn" href="#how-it-works" style={{ padding: '0.9rem 2rem' }}>
                Learn More
              </a>
            </div>
          </div>
        </Section>
      </main>
      <footer style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        marginTop: '2rem'
      }}>
        <div className="container" style={{
          padding: '3rem 0 2rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '2rem'
        }}>
          <div>
            <h3 style={{
              margin: '0 0 1rem 0',
              fontSize: '1.2rem',
              fontWeight: 900,
              letterSpacing: '0.01em'
            }}>
              Tossr
            </h3>
            <p style={{
              margin: 0,
              fontSize: '0.9rem',
              color: 'var(--muted)',
              lineHeight: 1.6
            }}>
              Provably fair betting powered by MagicBlock TEE and Solana
            </p>
          </div>

          <div>
            <h4 style={{
              margin: '0 0 1rem 0',
              fontSize: '0.85rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)'
            }}>
              Product
            </h4>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <a href="#markets" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>Markets</a>
              <a href="#how-it-works" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>How it Works</a>
              <a href="#live-rounds" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>Live Rounds</a>
              <a href="#faq" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>FAQ</a>
            </nav>
          </div>

          <div>
            <h4 style={{
              margin: '0 0 1rem 0',
              fontSize: '0.85rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)'
            }}>
              Resources
            </h4>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <a href="https://docs.tossr.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>Documentation</a>
              <a href="https://docs.magicblock.gg/TrustedExecutionLayer/Overview" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>TEE Verification</a>
              <a href="https://github.com/tossr" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>GitHub</a>
            </nav>
          </div>

          <div>
            <h4 style={{
              margin: '0 0 1rem 0',
              fontSize: '0.85rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)'
            }}>
              Community
            </h4>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <a href="https://twitter.com/tossr" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>Twitter</a>
              <a href="https://discord.gg/tossr" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>Discord</a>
              <a href="https://t.me/tossr" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>Telegram</a>
            </nav>
          </div>
        </div>

        <div className="container" style={{
          padding: '2rem 0',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <small style={{ color: 'var(--muted)' }}>
            © {new Date().getFullYear()} Tossr. All rights reserved.
          </small>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <a href="/terms" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Terms</a>
            <a href="/privacy" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
