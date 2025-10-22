import { useEffect, useRef } from 'react'

type Phase = 'field' | 'gather' | 'scatter'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  tx: number
  ty: number
}

const TAU = Math.PI * 2

function createRng(seed = 0xA5F12E31) {
  let s = seed >>> 0
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 0xffffffff)
  }
}

export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const phaseRef = useRef<Phase>('gather')
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number | null>(null)
  const centerRef = useRef({ x: 0, y: 0 })
  const rng = useRef(createRng(0x517cc1))
  const tRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { alpha: true })!

    const onResize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const rect = canvas.parentElement?.getBoundingClientRect()
      const w = Math.floor((rect?.width || window.innerWidth))
      const h = Math.floor((rect?.height || window.innerHeight))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      centerRef.current = { x: w / 2, y: h / 2 }
      if (particlesRef.current.length === 0) initParticles(w, h)
      updateTargets()
    }

    const initParticles = (w: number, h: number) => {
      const count = Math.min(360, Math.floor((w * h) / 12000))
      const arr: Particle[] = []
      for (let i = 0; i < count; i++) {
        arr.push({
          x: rng.current() * w,
          y: rng.current() * h,
          vx: (rng.current() - 0.5) * 0.25,
          vy: (rng.current() - 0.5) * 0.25,
          r: rng.current() * 1.0 + 0.5,
          tx: 0,
          ty: 0,
        })
      }
      particlesRef.current = arr
    }

    const updateTargets = () => {
      // Sunflower distribution (golden-angle) for balanced gathering
      const { x: cx, y: cy } = centerRef.current
      const n = particlesRef.current.length
      const radius = Math.min(canvas.width, canvas.height) / (window.devicePixelRatio || 1) * 0.32
      const phi = Math.PI * (3 - Math.sqrt(5)) // golden angle
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(i / n) * radius
        const theta = i * phi
        particlesRef.current[i].tx = cx + r * Math.cos(theta)
        particlesRef.current[i].ty = cy + r * Math.sin(theta)
      }
    }

    const vectorField = (x: number, y: number, t: number) => {
      // Smooth pseudo-random flow (no heavy noise libs)
      const s = Math.sin, c = Math.cos
      const k1 = 0.0009, k2 = 0.0013
      const a = s(x * k1 + t * 0.6) + c(y * k2 - t * 0.4)
      const b = c(x * k2 - t * 0.25) - s(y * k1 + t * 0.5)
      return { x: a, y: b }
    }

    const tick = () => {
      const { x: cx, y: cy } = centerRef.current
      const w = canvas.width / (window.devicePixelRatio || 1)
      const h = canvas.height / (window.devicePixelRatio || 1)

      // clear every frame to avoid blocking hero text perception
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, w, h)

      const mint = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b9f6c9'
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = mint
      ctx.shadowColor = mint
      ctx.shadowBlur = 6

      tRef.current += 0.016
      for (const p of particlesRef.current) {
        if (phaseRef.current === 'gather') {
          const dx = p.tx - p.x
          const dy = p.ty - p.y
          const dist = Math.hypot(dx, dy) + 1e-4
          const force = Math.min(0.014, 18 / (dist * dist))
          p.vx += dx * force
          p.vy += dy * force
          p.vx *= 0.90
          p.vy *= 0.90
        } else if (phaseRef.current === 'field') {
          const f = vectorField(p.x - cx, p.y - cy, tRef.current)
          p.vx += f.x * 0.10
          p.vy += f.y * 0.10
          p.vx *= 0.978
          p.vy *= 0.978
        } else { // scatter
          const dx = p.x - cx
          const dy = p.y - cy
          const dist = Math.hypot(dx, dy) + 1e-4
          const push = Math.min(0.017, 12 / (dist * 12))
          p.vx += (dx / dist) * push + (rng.current() - 0.5) * 0.05
          p.vy += (dy / dist) * push + (rng.current() - 0.5) * 0.05
          p.vx *= 0.985
          p.vy *= 0.985
        }

        p.x += p.vx
        p.y += p.vy

        if (p.x < -5) p.x = w + 5
        if (p.x > w + 5) p.x = -5
        if (p.y < -5) p.y = h + 5
        if (p.y > h + 5) p.y = -5

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, TAU)
        ctx.fill()
      }

      // lightweight linking for elegance
      ctx.shadowBlur = 0
      ctx.globalAlpha = 0.18
      ctx.strokeStyle = mint
      ctx.lineWidth = 0.5
      for (let i = 0; i < particlesRef.current.length; i += 10) {
        const a = particlesRef.current[i]
        const b = particlesRef.current[(i + 1) % particlesRef.current.length]
        const c = particlesRef.current[(i + 5) % particlesRef.current.length]
        if (a && b) {
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d < 60) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
        }
        if (a && c) {
          const d = Math.hypot(a.x - c.x, a.y - c.y)
          if (d < 60) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke() }
        }
      }
      ctx.globalAlpha = 1

      rafRef.current = requestAnimationFrame(tick)
    }

    const cycle = () => {
      const order: Phase[] = ['gather', 'field', 'scatter']
      const next = order[(order.indexOf(phaseRef.current) + 1) % order.length]
      phaseRef.current = next
      if (next === 'gather') updateTargets()
    }

    const interval = window.setInterval(cycle, 3800)
    window.addEventListener('resize', onResize)
    onResize()
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.clearInterval(interval)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="particle-wrap" />
}
