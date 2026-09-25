import { Outlet, ScrollRestoration } from 'react-router'
import { ImpersonationBanner } from '../components/Banners'
import { GlobalDialogs } from './GlobalDialogs'

/** Wraps every route: the impersonation banner must stay visible everywhere (incl. the editor). */
export function RootLayout() {
  return (
    <>
      <ImpersonationBanner />
      <Outlet />
      <GlobalDialogs />
      <ScrollRestoration />
    </>
  )
}
