// Route table. Every page is lazy-loaded (its own chunk); the editor and admin load only on demand.
import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { RootLayout } from './layout/RootLayout'
import { FullPageLoader, NotFoundPage, RouteError } from './components/PageStates'
import { ProjectRedirect } from './pages/ProjectRedirect'

type PageModule = { default: ComponentType }
const page = (load: () => Promise<PageModule>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
})

const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      {
        ...page(() => import('./layout/DashboardLayout')),
        children: [
          { index: true, ...page(() => import('./dashboard/HomePage')) },
          { path: 'projects', ...page(() => import('./dashboard/ProjectsPage')) },
          { path: 'projects/f/:folderId', ...page(() => import('./dashboard/ProjectsPage')) },
          { path: 'shared', ...page(() => import('./dashboard/SharedPage')) },
          { path: 'starred', ...page(() => import('./dashboard/StarredPage')) },
          { path: 'trash', ...page(() => import('./dashboard/TrashPage')) },
          { path: 'collections', ...page(() => import('./dashboard/CollectionsPage')) },
          { path: 'collections/:collectionId', ...page(() => import('./dashboard/CollectionsPage')) },
          { path: 'org/:orgId', ...page(() => import('./org/OrgPage')) },
          { path: 'org/:orgId/settings', ...page(() => import('./org/OrgSettingsPage')) },
          { path: 'support', ...page(() => import('./pages/SupportPage')) },
          {
            path: 'settings',
            ...page(() => import('./settings/SettingsLayout')),
            children: [
              { index: true, ...page(() => import('./settings/ProfilePage')) },
              { path: 'profile', ...page(() => import('./settings/ProfilePage')) },
              { path: 'security', ...page(() => import('./settings/SecurityPage')) },
              { path: 'appearance', ...page(() => import('./settings/AppearancePage')) },
              { path: 'privacy', ...page(() => import('./settings/PrivacyPage')) },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
          {
            path: 'admin',
            ...page(() => import('./admin/AdminLayout')),
            children: [
              { index: true, ...page(() => import('./admin/AdminOverview')) },
              { path: 'users', ...page(() => import('./admin/AdminUsers')) },
              { path: 'users/:userId', ...page(() => import('./admin/AdminUserDetail')) },
              { path: 'orgs', ...page(() => import('./admin/AdminOrgs')) },
              { path: 'projects', ...page(() => import('./admin/AdminProjects')) },
              { path: 'tickets', ...page(() => import('./admin/AdminTickets')) },
              { path: 'tickets/:ticketId', ...page(() => import('./admin/AdminTickets')) },
              { path: 'audit', ...page(() => import('./admin/AdminAudit')) },
              { path: 'announcements', ...page(() => import('./admin/AdminAnnouncements')) },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
      { path: 'p/:projectId', ...page(() => import('./pages/EditorRoute')) },
      { path: 'p/:projectId/:fileId', ...page(() => import('./pages/EditorRoute')) },
      { path: 'projects/:projectId', element: <ProjectRedirect /> },
      { path: 's/:token', ...page(() => import('./pages/ShareAcceptPage')) },
      { path: 'invite/:id', ...page(() => import('./pages/InvitePage')) },
      {
        ...page(() => import('./auth/AuthLayout')),
        children: [
          { path: 'login', ...page(() => import('./auth/LoginPage')) },
          { path: 'signup', ...page(() => import('./auth/SignupPage')) },
          { path: 'forgot-password', ...page(() => import('./auth/ForgotPasswordPage')) },
          { path: 'reset-password', ...page(() => import('./auth/ResetPasswordPage')) },
          { path: 'verify-email', ...page(() => import('./auth/VerifyEmailPage')) },
        ],
      },
      { path: 'legal/:doc', ...page(() => import('./legal/LegalPage')) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
