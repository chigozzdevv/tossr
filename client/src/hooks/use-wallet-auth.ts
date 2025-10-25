import { useCallback, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'
import { authService } from '@/services/auth.service'
import { useAuth } from '@/providers/auth-provider'

export function useWalletAuth() {
  const wallet = useWallet()
  const { setVisible } = useWalletModal()
  const { signIn } = useAuth()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const connect = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      if (!wallet.connected) {
        if (!wallet.wallet) {
          setVisible(true)
          return null
        }
        await wallet.connect()
      }
      if (!wallet.publicKey) {
        throw new Error('Wallet not ready')
      }
      if (!wallet.signMessage) {
        throw new Error('Selected wallet does not support message signing')
      }

      const publicKey = wallet.publicKey.toBase58()
      const nonce = await authService.requestNonce(publicKey)
      const encodedMessage = new TextEncoder().encode(nonce.message)
      const signatureBytes = await wallet.signMessage(encodedMessage)
      const signature = bs58.encode(signatureBytes)
      await signIn({
        message: nonce.message,
        signature,
        publicKey,
      })
      return publicKey
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message : 'Failed to connect wallet'
      setError(msg)
      console.error(err)
      return null
    } finally {
      setLoading(false)
    }
  }, [setVisible, signIn, wallet])

  return {
    connect,
    loading,
    error,
    clearError: () => setError(''),
  }
}
