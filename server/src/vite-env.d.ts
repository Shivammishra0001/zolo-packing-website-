/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL, e.g. http://localhost:8000 */
  readonly VITE_API_URL?: string
  /** "true" exposes the development-only demo role switcher. */
  readonly VITE_DEMO_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
