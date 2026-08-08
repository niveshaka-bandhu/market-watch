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
- Multi-stage DCF calculator

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

- **Primary**: Stooq historical daily data (works reliably in browser)
- **Fallback**: Yahoo Finance chart endpoint
- Fundamentals, news, shareholding and peer data require an API key or small backend (placeholders are ready)

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
