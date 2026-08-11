# Indian Quant Verdict Dashboard

Institutional-style quant analysis dashboard for **Indian stocks (NSE / BSE)**.

Rebuilt from the original Streamlit version as a **pure frontend Progressive Web App** that you can host free on GitHub Pages.

## Features

### Market View & Full Verdict
- Live price + daily change
- Technical indicators: SMA 50/200, RSI(14), MACD, Bollinger Bands, ATR
- Multi-factor Bull / Bear verdict engine (same institutional language as original)
- Interactive candlestick chart with overlays
- Classic pivot points + ATR
- Graham Number calculator
- Graham Formula (V = EPS × (8.5 + 2g))
- Peter Lynch Fair Value calculator

### Quantitative Deep-Dive
- Quality / Solvency factor matrix (ready for API data)
- 30-day Monte Carlo price simulations
- Historical strategy backtester (SMA Crossover & MACD Crossover)
- Extensible for peers, news, shareholding, etc.

## How to use

1. Enter any Indian ticker without suffix: `RELIANCE`, `TCS`, `INFY`, `HDFCBANK`, `SBIN`, `LICI`, etc.
2. The app automatically appends `.NS` (NSE).
3. Click **Analyse** or press Enter.

## Data sources

- **Price/OHLC chart**: Yahoo Finance chart endpoint, tried directly and via a
  few public CORS proxies **in parallel** (first one to answer wins).
- **Fundamentals**: a Google Apps Script backend (`AppsScript_Screener.gs`)
  that drives a live screener.in scrape through a Google Sheet
  (`Equity` + `Screener` tabs).

## Backend reliability fixes (see `AppsScript_Screener.gs`)

The original Apps Script wrote the ticker into a cell, blind-slept 12
seconds, then read whatever was there — with no protection against two
requests overlapping. That caused wrong/missing data under any concurrent
use and was slow even for repeat lookups. The current version:

1. **Locks** each analyse request with `LockService` so two tickers can
   never collide in the shared sheet.
2. **Polls** the "Current Price" cell until it actually changes (capped at
   25s) instead of always waiting a fixed 12s regardless of how long the
   screener.in scrape takes.
3. **Caches** results per ticker for 15 minutes with `CacheService`, so
   repeat lookups return near-instantly and don't re-hit screener.in.

To deploy: paste `AppsScript_Screener.gs` into Extensions → Apps Script,
replacing the old code, then Deploy → Manage deployments → Edit → New
version → Deploy.

## Deploy on GitHub Pages

1. Create a new repository on GitHub.
2. Upload / push the contents of this folder.
3. Go to **Settings → Pages**.
4. Source: Deploy from branch `main` (or `master`), folder `/ (root)`.
5. Wait a minute → your app is live at `https://<username>.github.io/<repo>/`

You can also install it as a PWA on phone or desktop.

## Local testing

Just open `index.html` in a modern browser,  
or run a simple static server:

```bash
npx serve .
# or
python -m http.server 8000
```

## Project structure

```
indian-quant-verdict/
├── index.html
├── manifest.json          # PWA manifest
├── sw.js                  # Service worker
├── css/quant.css
├── js/
│   ├── app.js             # Main controller
│   ├── data.js            # Stooq + Yahoo fetch
│   ├── indicators.js      # All technical calculations
│   ├── verdict.js         # Bull/Bear scoring engine
│   └── charts.js          # Plotly helpers
└── icons/
```

## Next upgrades (optional)

- Add Finnhub / Twelve Data / Alpha Vantage key for live fundamentals & news
- Sector-aware peer comparison
- Shareholding pattern
- Dark/light toggle
- Export PDF report

---

Built as a clean replacement for the original Streamlit “Indian Quant Verdict” dashboard.
