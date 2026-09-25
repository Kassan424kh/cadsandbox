// sonner Toaster themed with CadSandbox tokens. Mount once at the app root; call `toast(...)`.
import { Toaster as SonnerToaster, toast } from 'sonner'
import { useTheme } from './theme'

export { toast }

export function Toaster({ position = 'bottom-right' }: { position?: 'bottom-right' | 'bottom-center' | 'top-center' | 'top-right' }) {
  const { resolved } = useTheme()
  return (
    <SonnerToaster
      theme={resolved}
      position={position}
      offset={{ bottom: 64, right: 16 }}
      mobileOffset={{ bottom: 72 }}
      gap={8}
      visibleToasts={4}
      closeButton
      toastOptions={{
        duration: 3500,
        style: {
          background: 'var(--cs-glass-strong)',
          backdropFilter: 'blur(var(--cs-blur)) saturate(1.5)',
          WebkitBackdropFilter: 'blur(var(--cs-blur)) saturate(1.5)',
          border: '1px solid var(--cs-glass-border)',
          borderRadius: 'var(--cs-radius-md)',
          boxShadow: 'var(--cs-shadow-3), inset 0 1px 0 var(--cs-glass-highlight)',
          color: 'var(--cs-text)',
          fontFamily: 'var(--cs-font-sans)',
          fontSize: 'var(--cs-text-sm)',
          padding: '12px 14px',
        },
        classNames: {
          description: 'cs-toast-desc',
          actionButton: 'cs-toast-action',
        },
      }}
      icons={{}}
    />
  )
}
