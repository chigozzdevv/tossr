import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app.tsx'
import { AuthProvider } from './providers/auth-provider.tsx'
import { SolanaWalletProviders } from './providers/wallet-provider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SolanaWalletProviders>
      <AuthProvider>
        <App />
      </AuthProvider>
    </SolanaWalletProviders>
  </StrictMode>,
)
