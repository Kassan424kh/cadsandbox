// Account menu (bottom of the sidebar): theme, language, install app, settings, sign out.
import { useNavigate } from 'react-router'
import { ChevronsUpDown, Download, Languages, LifeBuoy, LogOut, Monitor, Moon, Settings, Shield, Sun } from 'lucide-react'
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  toast,
  useTheme,
  type ThemeSetting,
} from '../../ui'
import { LANGUAGES, setLanguage, useLanguage, useT, type Lang } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { userColor } from '../../data/session/user'
import { useInstallPrompt } from '../pwa'
import { useDashboardUI } from '../dashboard/store'
import s from './layout.module.css'

export function ThemeLanguageItems() {
  const t = useT()
  const { theme, setTheme } = useTheme()
  const lang = useLanguage()
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger icon={theme === 'light' ? <Sun size={15} /> : theme === 'dark' ? <Moon size={15} /> : <Monitor size={15} />}>
          {t('menu.theme', 'Theme')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeSetting)}>
            <DropdownMenuRadioItem value="dark" icon={<Moon size={15} />}>
              {t('theme.dark', 'Dark')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light" icon={<Sun size={15} />}>
              {t('theme.light', 'Light')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" icon={<Monitor size={15} />}>
              {t('theme.system', 'System')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger icon={<Languages size={15} />}>{t('menu.language', 'Language')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={lang} onValueChange={(v) => void setLanguage(v as Lang)}>
            {LANGUAGES.map((l) => (
              <DropdownMenuRadioItem key={l.id} value={l.id}>
                {l.native}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}

export function UserMenu() {
  const t = useT()
  const auth = useAuth()
  const navigate = useNavigate()
  const { canInstall, install } = useInstallPrompt()
  const setSupportOpen = useDashboardUI((st) => st.setSupportOpen)
  const user = auth.user
  if (!user) return null
  const signOut = async () => {
    await auth.signOut()
    toast.success(t('auth.signedOut', 'Signed out. Cloud data cached on this device was removed.'))
    navigate('/')
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={s.userButton} aria-label={t('menu.account', 'Account menu')}>
          <Avatar name={user.name || user.email} src={user.image} color={userColor(user.id)} size={32} />
          <span className={s.userText}>
            <strong>{user.name || t('menu.unnamed', 'Unnamed')}</strong>
            <span>{user.email}</span>
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} style={{ minWidth: 240 }}>
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuItem icon={<Settings size={15} />} onSelect={() => navigate('/settings')}>
          {t('nav.settings', 'Settings')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Shield size={15} />} onSelect={() => navigate('/settings/privacy')}>
          {t('nav.privacy', 'Privacy center')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<LifeBuoy size={15} />} onSelect={() => setSupportOpen(true)}>
          {t('nav.contactSupport', 'Contact support')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeLanguageItems />
        {canInstall && (
          <DropdownMenuItem icon={<Download size={15} />} onSelect={() => void install()}>
            {t('menu.install', 'Install app')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LogOut size={15} />} onSelect={() => void signOut()}>
          {t('auth.signOut', 'Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
