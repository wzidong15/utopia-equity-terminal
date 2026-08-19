/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVE_REFRESH_SEC?: string;
  readonly FINTOPIA_LIVE_REFRESH_SEC?: string;
  readonly UTOPIA_LIVE_REFRESH_SEC?: string;
  readonly VITE_CHART_REFRESH_SEC?: string;
  readonly FINTOPIA_CHART_REFRESH_SEC?: string;
  readonly UTOPIA_CHART_REFRESH_SEC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
