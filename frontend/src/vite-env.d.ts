/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVE_REFRESH_SEC?: string;
  readonly ZINTOPIA_LIVE_REFRESH_SEC?: string;
  readonly FINTOPIA_LIVE_REFRESH_SEC?: string;
  readonly UTOPIA_LIVE_REFRESH_SEC?: string;
  readonly VITE_CHART_REFRESH_SEC?: string;
  readonly ZINTOPIA_CHART_REFRESH_SEC?: string;
  readonly FINTOPIA_CHART_REFRESH_SEC?: string;
  readonly UTOPIA_CHART_REFRESH_SEC?: string;
  readonly VITE_NEWS_REFRESH_SEC?: string;
  readonly ZINTOPIA_NEWS_REFRESH_SEC?: string;
  readonly FINTOPIA_NEWS_REFRESH_SEC?: string;
  readonly UTOPIA_NEWS_REFRESH_SEC?: string;
  readonly VITE_MARKET_NEWS_REFRESH_SEC?: string;
  readonly ZINTOPIA_MARKET_NEWS_REFRESH_SEC?: string;
  readonly FINTOPIA_MARKET_NEWS_REFRESH_SEC?: string;
  readonly UTOPIA_MARKET_NEWS_REFRESH_SEC?: string;
  readonly VITE_TICKER_NEWS_REFRESH_SEC?: string;
  readonly ZINTOPIA_TICKER_NEWS_REFRESH_SEC?: string;
  readonly FINTOPIA_TICKER_NEWS_REFRESH_SEC?: string;
  readonly UTOPIA_TICKER_NEWS_REFRESH_SEC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
