/**
 * Yahoo chart with CORS fallbacks. Fundamentals from Google Sheets.
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

  async function fetchText(url, ms) {
    const res = await withTimeout(
      fetch(url, { cache: 'no-store', mode: 'cors' }),
      ms || 8000
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }

  async function fetchJson(url, ms) {
    const text = await fetchText(url, ms);
    return JSON.parse(text);
  }

  function chartUrls(ticker) {
    const path = '/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=1d&range=2y';
    const direct = [
      'https://query1.finance.yahoo.com' + path,
      'https://query2.finance.yahoo.com' + path
    ];
    const proxies = [
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(direct[0]),
      'https://corsproxy.io/?' + encodeURIComponent(direct[0]),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(direct[0])
    ];
    return direct.concat(proxies);
  }

  function parseChart(json) {
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp) throw new Error('Empty chart');
    const meta = result.meta || {};
    const ts = result.timestamp;
    const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!q) throw new Error('No OHLCV');
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
    if (rows.length < 20) throw new Error('Insufficient history');
    return { history: rows, meta };
  }

  async function fetchYahooChart(ticker) {
    const urls = chartUrls(ticker);
    // Race every direct/proxy URL in parallel instead of trying them one at a
    // time. Sequentially, N failing sources each waiting out a 7s timeout
    // means up to N*7s before giving up. In parallel, worst case is ~7s
    // regardless of how many fallbacks we have, and we return as soon as the
    // first one succeeds.
    const attempts = urls.map((url) =>
      fetchJson(url, 8000).then((json) => parseChart(json))
    );
    return firstSuccess(attempts);
  }

  function firstSuccess(promises) {
    return new Promise((resolve, reject) => {
      let remaining = promises.length;
      const errors = [];
      if (remaining === 0) {
        reject(new Error('No data sources configured'));
        return;
      }
      promises.forEach((p) => {
        p.then(resolve).catch((e) => {
          errors.push(e);
          remaining -= 1;
          if (remaining === 0) {
            reject(errors[errors.length - 1] || new Error('All sources failed'));
          }
        });
      });
    });
  }

  async function loadAll(ticker) {
    try {
      const chart = await fetchYahooChart(ticker);
      const info = {
        symbol: ticker,
        shortName: (chart.meta && chart.meta.shortName) || ticker.replace('.NS', ''),
        longName: chart.meta && chart.meta.longName,
        currentPrice: chart.meta && chart.meta.regularMarketPrice,
        previousClose: chart.meta && chart.meta.chartPreviousClose,
        fiftyTwoWeekHigh: chart.meta && chart.meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: chart.meta && chart.meta.fiftyTwoWeekLow,
        fundamentalsLive: false,
        chartOk: true
      };
      return { history: chart.history, info, meta: chart.meta };
    } catch (e) {
      console.warn('Chart failed, continuing without price series:', e);
      return {
        history: null,
        info: {
          symbol: ticker,
          shortName: ticker.replace('.NS', ''),
          chartOk: false,
          fundamentalsLive: false
        },
        meta: null,
        chartError: String(e.message || e)
      };
    }
  }

  return { normalizeTicker, loadAll };
})();
