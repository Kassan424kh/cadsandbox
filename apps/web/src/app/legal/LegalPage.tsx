// /legal/:doc — imprint, privacy policy, terms (German + English). Rendered as text, never HTML.
import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Logo, SegmentedControl } from '../../ui'
import { useLanguage, useT } from '../../i18n'
import { useDocumentTitle } from '../hooks'
import { NotFoundPage } from '../components/PageStates'
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
  const content = set?.[lang]
  useDocumentTitle(content?.title)
  if (!set || !content) return <NotFoundPage />
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
                ? 'Vorlage: Markierte Angaben müssen vom Betreiber ergänzt und rechtlich geprüft werden.'
                : 'Template: highlighted details must be completed by the operator and legally reviewed.'}
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
