// Why a project is read-only for everyone (see ProjectDTO.writeBlock) — shared by toasts and hints.
import type { WriteBlock } from '@cadsandbox/shared'
import type { t as translate } from '../i18n'

export function writeBlockMessage(t: typeof translate, block: WriteBlock, isOwner: boolean): string {
  if (block === 'design_too_large') {
    return t('editor.designTooLarge', 'This design reached the size limit and is read-only. Split it into several design files or remove large imported objects.')
  }
  return isOwner
    ? t('editor.storageFullOwner', 'Your storage is full, so this project is read-only. Delete files or projects you no longer need to keep editing.')
    : t('editor.storageFullMember', 'The owner’s storage is full, so this project is read-only until they free up space.')
}
