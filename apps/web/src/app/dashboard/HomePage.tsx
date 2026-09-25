// Home: welcome hero, templates, recent projects.
import { useMemo } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Clock, Plus, Sparkles } from 'lucide-react'
import { BRAND } from '@cadsandbox/shared'
import { Button, EmptyState } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { sortProjects } from '../../data/projects'
import { useDocumentTitle } from '../hooks'
import { TEMPLATES } from '../templates'
import { PendingInvitations } from '../org/PendingInvitations'
import { ProjectGrid } from './ProjectGrid'
import { TemplateArt } from './TemplateArt'
import { useDashboardUI } from './store'
import { useProjectsView } from './useProjectsView'
import s from './dashboard.module.css'
import { LinkButton } from '../components/LinkButton'

const RECENT = 8

export default function HomePage() {
  const t = useT()
  const auth = useAuth()
  const openNewProject = useDashboardUI((st) => st.openNewProject)
  const data = useProjectsView('recent')
  useDocumentTitle(t('nav.home', 'Home'))
  const recent = useMemo(() => sortProjects([...data.primary, ...data.device], 'updated').slice(0, RECENT), [data.primary, data.device])
  const firstName = auth.user?.name.split(' ')[0]

  return (
    <div className={s.page}>
      <section className={s.hero}>
        <h1 className={s.heroTitle}>
          {firstName ? t('home.greeting', 'Welcome back, {name}', { name: firstName }) : t('home.title', 'Design, draft and build together')}
        </h1>
        <p className={s.heroText}>
          {auth.status === 'signed-in'
            ? t('home.subtitleSignedIn', 'Pick up where you left off, or start something new. Everything runs on your device and syncs when you are online.')
            : t('home.subtitle', '{brand} runs entirely in your browser. No account needed — your projects stay on this device until you choose to sync.', { brand: BRAND.name })}
        </p>
        <div className={s.heroActions}>
          <Button variant="primary" size="lg" icon={<Plus size={18} />} onClick={() => openNewProject()}>
            {t('dashboard.newProject', 'New project')}
          </Button>
          <LinkButton to="/projects" variant="secondary" size="lg" iconRight={<ArrowRight size={16} />}>{t('home.browse', 'Browse projects')}</LinkButton>
        </div>
      </section>

      <PendingInvitations />

      <section aria-labelledby="home-templates">
        <div className={s.sectionHead}>
          <h2 id="home-templates" className={s.sectionTitle}>
            <Sparkles size={16} /> {t('home.templates', 'Start from a template')}
          </h2>
        </div>
        <div className={s.templates}>
          {TEMPLATES.map((tpl) => (
            <button key={tpl.id} type="button" className={s.template} onClick={() => openNewProject({ template: tpl.id })}>
              <div className={s.templateArt}>
                <TemplateArt id={tpl.id} />
              </div>
              <div className={s.templateBody}>
                <strong>{t(tpl.name[0], tpl.name[1])}</strong>
                <span>{t(tpl.description[0], tpl.description[1])}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="home-recent">
        <div className={s.sectionHead}>
          <h2 id="home-recent" className={s.sectionTitle}>
            <Clock size={16} /> {t('home.recent', 'Recent projects')}
          </h2>
          {recent.length > 0 && (
            <Link to="/projects" className={s.sectionHint}>
              {t('home.viewAll', 'View all')}
            </Link>
          )}
        </div>
        <ProjectGrid
          items={recent}
          folders={data.folders}
          loading={data.loading}
          empty={
            <EmptyState
              icon={<Plus size={22} />}
              title={t('home.emptyTitle', 'Your first project is one click away')}
              description={t('home.emptyDesc', 'Choose a template above — a furnished floor plan is a great place to explore.')}
            />
          }
        />
      </section>
    </div>
  )
}
