/**
 * Yahoo chart only (price history). Fundamentals come from Google Sheets / Screener.
 */
const DataService = (() => {
  function normalizeTicker(raw) {
    let t = (raw || '').toUpperCase().trim();
    if (!t) return null;
    if (t.startsWith('^') || t.includes('.')) return t;
    return t + '.NS';
  }

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ]);
  }

  async function fetchJson(url) {
    const res = await withTimeout(
      fetch(url, { cache: 'no-store', mode: 'cors', headers: { Accept: 'application/json' } }),
      8000
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function fetchYahooChart(ticker) {
    const path = '/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=1d&range=2y';
    const urls = [
      'https://query1.finance.yahoo.com' + path,
      'https://query2.finance.yahoo.com' + path
    ];
    const json = await Promise.any(urls.map(u => fetchJson(u))).catch(() => null);
    if (!json) throw new Error('Yahoo chart failed');
    const result = json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp) throw new Error('Empty chart');
    const meta = result.meta || {};
    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const rows = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] == null || isNaN(q.close[i])) continue;
      rows.push({
        date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        open: Number(q.open[i]) || Number(q.close[i]),
        high: Number(q.high[i]) || Number(q.close[i]),
        low: Number(q.low[i]) || Number(q.close[i]),
        close: Number(q.close[i]),
        volume: Number(q.volume[i]) || 0
      });
    }
    if (rows.length < 30) throw new Error('Insufficient history');
    return { history: rows, meta };
  }

  async function loadAll(ticker) {
    const chart = await fetchYahooChart(ticker);
    const info = {
      symbol: ticker,
      shortName: (chart.meta && chart.meta.shortName) || ticker.replace('.NS', ''),
      longName: chart.meta && chart.meta.longName,
      currentPrice: chart.meta && chart.meta.regularMarketPrice,
      previousClose: chart.meta && chart.meta.chartPreviousClose,
      fiftyTwoWeekHigh: chart.meta && chart.meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: chart.meta && chart.meta.fiftyTwoWeekLow,
      fundamentalsLive: false
    };
    return { history: chart.history, info, meta: chart.meta };
  }

  return { normalizeTicker, loadAll };
})();
