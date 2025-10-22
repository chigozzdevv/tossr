import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

type Variant = 'primary' | 'surface' | 'ghost'

type Props = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant
  }
>

export function Button({ variant = 'surface', className, ...rest }: Props) {
  const base = 'btn'
  const variants: Record<Variant, string> = {
    primary: 'btn-primary',
    surface: '',
    ghost: '',
  }
  const cls = [base, variants[variant], className].filter(Boolean).join(' ')
  return <button className={cls} {...rest} />
}

