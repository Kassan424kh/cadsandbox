// /legal/:doc — imprint, privacy policy, terms (German + English). Rendered as text, never HTML.
import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Logo, SegmentedControl } from '../../ui'
import { useLanguage, useT } from '../../i18n'
import { useDocumentTitle } from '../hooks'
import { FullPageLoader, NotFoundPage } from '../components/PageStates'
import { api } from '../../data/api/endpoints'
import { fillOperator } from './operator'
import { imprint } from './imprint'
import { privacy } from './privacy'
import { terms } from './terms'
import type { LegalDocId, LegalSet } from './types'
import s from './legal.module.css'

const DOCS: Record<LegalDocId, LegalSet> = { imprint, privacy, terms }
const PLACEHOLDER = /(\[PLACEHOLDER:[^\]]*\])/g

/** Highlight "[PLACEHOLDER: …]" markers so missing operator data is impossible to overlook. */
function Text({ children }: { children: string }) {
  const parts = children.split(PLACEHOLDER)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('[PLACEHOLDER:') ? (
          <mark key={i} className={s.placeholder}>
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

export default function LegalPage() {
  const t = useT()
  const uiLang = useLanguage()
  const { doc = '' } = useParams()
  const [lang, setLang] = useState<'de' | 'en'>(uiLang)
  const set = (DOCS as Record<string, LegalSet | undefined>)[doc]
  const operator = useQuery({ queryKey: ['legal-operator'], queryFn: api.legal.operator, staleTime: 60_000, retry: 1 })
  const raw = set?.[lang]
  useDocumentTitle(raw?.title)
  if (!set || !raw) return <NotFoundPage />
  if (operator.isPending) return <FullPageLoader />
  const content = fillOperator(raw, operator.data?.operator ?? null, lang)
  const hasPlaceholders = JSON.stringify(content).includes('[PLACEHOLDER')
  return (
    <div className={s.shell}>
      <header className={s.top}>
        <Link to="/" className={s.back}>
          <ArrowLeft size={16} /> <Logo size={20} />
        </Link>
        <SegmentedControl<'de' | 'en'>
          size="sm"
          value={lang}
          onChange={setLang}
          aria-label={t('menu.language', 'Language')}
          options={[
            { value: 'de', label: 'Deutsch' },
            { value: 'en', label: 'English' },
          ]}
        />
      </header>
      <main className={s.main}>
        <article className={s.doc} lang={lang}>
          <h1>{content.title}</h1>
          <p className={s.updated}>
            {lang === 'de' ? 'Stand' : 'Last updated'}: <Text>{content.updated}</Text>
          </p>
          {hasPlaceholders && (
            <p className={s.warning} role="note">
              <TriangleAlert size={15} />
              {lang === 'de'
                ? 'Markierte Angaben fehlen noch — Administratoren tragen sie unter Admin → Rechtliches ein.'
                : 'Highlighted details are missing — admins fill them in under Admin → Legal.'}
            </p>
          )}
          {content.intro && (
            <p className={s.intro}>
              <Text>{content.intro}</Text>
            </p>
          )}
          {content.sections.map((sec) => (
            <section key={sec.heading}>
              <h2>{sec.heading}</h2>
              {sec.body.map((b, i) =>
                typeof b === 'string' ? (
                  <p key={i}>
                    <Text>{b}</Text>
                  </p>
                ) : (
                  <ul key={i}>
                    {b.list.map((li, j) => (
                      <li key={j}>
                        <Text>{li}</Text>
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </section>
          ))}
        </article>
        <nav className={s.footer} aria-label={t('legal.nav', 'Legal')}>
          <Link to="/legal/imprint">{t('legal.imprint', 'Imprint')}</Link>
          <Link to="/legal/privacy">{t('legal.privacy', 'Privacy policy')}</Link>
          <Link to="/legal/terms">{t('legal.terms', 'Terms of service')}</Link>
          <Link to="/settings/privacy">{t('nav.privacy', 'Privacy center')}</Link>
        </nav>
      </main>
    </div>
  )
}
