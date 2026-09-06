import { t } from '@i18n/index'

/** Application shell. Screens are added per milestone. */
export function App() {
  return (
    <>
      <div class="cv-desktop-only">{t('app.desktopOnly')}</div>
      <div class="cv-shell">
        <header class="cv-header">
          <h1>{t('app.title')}</h1>
          <span class="cv-muted">{t('app.tagline')}</span>
        </header>
        <main class="cv-main" />
      </div>
    </>
  )
}
