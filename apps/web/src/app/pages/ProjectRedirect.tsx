// /projects/:projectId (links in e-mails) → the editor route /p/:projectId.
import { Navigate, useLocation, useParams } from 'react-router'

export function ProjectRedirect() {
  const { projectId = '' } = useParams()
  const { search } = useLocation()
  return <Navigate to={`/p/${encodeURIComponent(projectId)}${search}`} replace />
}
