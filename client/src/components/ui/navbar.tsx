import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from './button'
import { useWalletAuth } from '@/hooks/use-wallet-auth'
import { useAuth } from '@/providers/auth-provider'

export function Navbar() {
  const [solid, setSolid] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { connect, loading, error, clearError } = useWalletAuth()

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

  const handleConnect = useCallback(async () => {
    clearError()
    if (user) {
      navigate('/app')
      return
    }
    const publicKey = await connect()
    if (publicKey) {
      navigate('/app')
    }
  }, [clearError, connect, navigate, user])

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
          <a href="#live-rounds" className="nav-link">Rounds</a>
          <a href="#faq" className="nav-link">FAQ</a>
        </nav>
        <div className="nav-cta">
          <Button variant="primary" aria-label="Connect wallet" onClick={handleConnect} disabled={loading}>
            {user ? 'Dashboard' : 'Connect'}
          </Button>
        </div>
        {error ? <span className="nav-error" role="status">{error}</span> : null}
      </div>
    </header>
  )
}
