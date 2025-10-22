import { Navbar } from '../../components/ui/navbar'
import { Hero } from './sections/hero'
import { MarketsSection } from './sections/markets'
import { MarketEventsSection } from './sections/market-events'
import { HowItWorksSection } from './sections/how-it-works'
import { Section, SectionDivider } from '../../components/ui/section'
import { Button } from '../../components/ui/button'

export function LandingPage() {
  return (
    <div>
      <Navbar />
      <main>
        <Hero />
        <SectionDivider />
        <MarketsSection />
        <SectionDivider />
        <MarketEventsSection />
        <SectionDivider />
        <HowItWorksSection />
        <Section id="get-started">
          <div className="container">
            <h2 className="section-title">Ready to try Tossr?</h2>
            <p className="section-sub">Kick off onboarding to place your first verifiable bet.</p>
            <div className="row" style={{ marginTop: '1rem' }}>
              <Button variant="primary">Get started</Button>
              <a className="btn" href="#features">Learn more</a>
            </div>
          </div>
        </Section>
      </main>
      <footer>
        <div className="container" style={{ padding: '2rem 0', color: 'var(--muted)' }}>
          <small>© {new Date().getFullYear()} Tossr</small>
        </div>
      </footer>
    </div>
  )
}
