// Dev-only entry (not part of the app bundle). Open /src/editor/dev/index.html on the Vite server.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../styles/global.css'
import { initTheme } from '../../ui'
import { DevPreview } from './DevPreview'

initTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevPreview />
  </StrictMode>,
)
