import { ParticleField } from '@/components/animations/particle-field'
import { Button } from '@/components/ui/button'

export function Hero() {
  return (
    <section className="hero">
      <ParticleField />
      <div className="container hero-inner">
        <div>
          <h1 className="hero-heading">Bet on Provable Randomness</h1>
          <p className="hero-sub">
            TEE‑attested randomness for range, parity, digit, modulo, pattern, jackpot
            and community markets — settled on Solana with MagicBlock.
          </p>
          <div className="row row-center">
            <a href="#get-started" className="btn btn-primary">Get started</a>
            <Button className="hidden sm:inline-flex" aria-label="Learn more">Learn more</Button>
          </div>
        </div>
      </div>
    </section>
  )
}
