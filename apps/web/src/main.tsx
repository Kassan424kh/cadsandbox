import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { initTheme } from './ui'
import { initI18n } from './i18n'
import { App } from './app/App'
import { setupPWA } from './app/pwa'
import { purgeExpiredTrash } from './data/local/projects'

initTheme()
setupPWA()
await initI18n()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Local-first housekeeping, off the critical path.
const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500))
idle(() => void purgeExpiredTrash().catch(() => undefined))
