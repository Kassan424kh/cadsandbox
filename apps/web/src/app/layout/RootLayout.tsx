import { useEffect } from 'react'
import { Outlet, ScrollRestoration } from 'react-router'
import { useServer } from '../../data/online'
import { enableErrorReporting } from '../errorReporting'
import { ImpersonationBanner } from '../components/Banners'
import { TermsGate } from '../components/TermsGate'
import { GlobalDialogs } from './GlobalDialogs'

/** Wraps every route: the impersonation banner must stay visible everywhere (incl. the editor). */
export function RootLayout() {
  const { config } = useServer()
  useEffect(() => {
    if (config?.features.errorReporting) enableErrorReporting(config.version)
  }, [config])
  return (
    <>
      <ImpersonationBanner />
      <Outlet />
      <GlobalDialogs />
      <TermsGate />
      <ScrollRestoration />
    </>
  )
}
