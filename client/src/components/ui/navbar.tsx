import { useEffect, useState } from 'react'
import { Button } from './button'

export function Navbar() {
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const hero = document.querySelector('section.hero')
    if (!hero) {
      setSolid(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => setSolid(!entry.isIntersecting),
      { threshold: 0.01, rootMargin: '-56px 0px 0px 0px' }
    )
    io.observe(hero)
    return () => io.disconnect()
  }, [])

  return (
    <header className={`nav ${solid ? 'solid' : ''}`}>
      <div className="container nav-inner">
        <a href="/" className="brand" aria-label="Tossr home">
          <img src="/logo-tossr.svg" alt="" className="brand-mark" aria-hidden />
          <span>tossr</span>
        </a>
        <nav className="nav-center" aria-label="Primary">
          <a href="#how-it-works" className="nav-link">How it works</a>
          <a href="#markets" className="nav-link">Markets</a>
          <a href="#docs" className="nav-link">Docs</a>
          <a href="#community" className="nav-link">Community</a>
        </nav>
        <div className="nav-cta">
          <Button variant="primary" aria-label="Log in">Log in</Button>
        </div>
      </div>
    </header>
  )
}
