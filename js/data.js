/**
 * Fast Yahoo Finance data layer
 * - Chart only (fast path)
 * - 1 race + short timeout
 * - Fundamentals optional (non-blocking)
 */

const DataService = (() => {
  function normalizeTicker(raw) {
    let t = (raw || '').toUpperCase().trim();
    if (!t) return null;
    if (t.startsWith('^')) return t;
    if (t.includes('.')) return t;
    return t + '.NS';
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ]);
  }

  async function fetchJson(url, ms) {
    const res = await withTimeout(
      fetch(url, { cache: 'no-store', mode: 'cors', headers: { Accept: 'application/json' } }),
      ms || 6000
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
    const result = await Promise.any(
      urls.map(u => fetchJson(u, 7000))
    ).catch(() => null);

    if (!result) throw new Error('Yahoo chart failed');
    return parseChart(result, ticker);
  }

  function parseChart(json, ticker) {
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
    if (rows.length < 30) throw new Error('Insufficient history');
    return { history: rows, meta };
  }

  function emptyInfo(ticker, meta) {
    meta = meta || {};
    return {
      symbol: ticker,
      shortName: meta.shortName || ticker.replace('.NS', '').replace('.BO', ''),
      longName: meta.longName || null,
      currency: meta.currency || 'INR',
      exchange: meta.fullExchangeName || meta.exchangeName || 'NSE',
      currentPrice: meta.regularMarketPrice || null,
      previousClose: meta.chartPreviousClose || null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow || null,
      regularMarketVolume: meta.regularMarketVolume || null,
      trailingPE: null, forwardPE: null, priceToBook: null, pegRatio: null,
      returnOnEquity: null, returnOnAssets: null, operatingMargins: null, profitMargins: null,
      debtToEquity: null, currentRatio: null, beta: null, marketCap: null,
      enterpriseValue: null, trailingEps: null, bookValue: null, freeCashflow: null,
      totalCash: null, totalDebt: null, revenueGrowth: null, earningsGrowth: null,
      sharesOutstanding: null, heldPercentInsiders: null, heldPercentInstitutions: null,
      dividendYield: null, payoutRatio: null, averageVolume: null,
      fundamentalsLive: false, news: []
    };
  }

  function raw(obj) {
    var keys = Array.prototype.slice.call(arguments, 1);
    var v = obj;
    for (var i = 0; i < keys.length; i++) {
      if (v == null) return null;
      v = v[keys[i]];
    }
    if (v && typeof v === 'object' && 'raw' in v) return v.raw;
    return v == null ? null : v;
  }

  function firstNum() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] != null && !isNaN(arguments[i])) return arguments[i];
    }
    return null;
  }

  async function tryFundamentals(ticker, meta) {
    try {
      const modules = 'price,summaryDetail,defaultKeyStatistics,financialData,summaryProfile,majorHoldersBreakdown';
      const url = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/' +
        encodeURIComponent(ticker) + '?modules=' + modules;
      const json = await fetchJson(url, 4000);
      const r = json && json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0];
      if (!r) return emptyInfo(ticker, meta);

      const price = r.price || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {};
      const fd = r.financialData || {}, sp = r.summaryProfile || {}, mh = r.majorHoldersBreakdown || {};
      const info = emptyInfo(ticker, meta);
      info.fundamentalsLive = true;
      info.shortName = raw(price, 'shortName') || info.shortName;
      info.longName = raw(price, 'longName') || info.longName;
      info.sector = raw(sp, 'sector');
      info.industry = raw(sp, 'industry');
      info.currentPrice = raw(price, 'regularMarketPrice') || info.currentPrice;
      info.trailingPE = firstNum(raw(sd, 'trailingPE'), raw(ks, 'trailingPE'));
      info.priceToBook = firstNum(raw(sd, 'priceToBook'), raw(ks, 'priceToBook'));
      info.pegRatio = raw(ks, 'pegRatio');
      info.returnOnEquity = raw(fd, 'returnOnEquity');
      info.returnOnAssets = raw(fd, 'returnOnAssets');
      info.operatingMargins = raw(fd, 'operatingMargins');
      info.profitMargins = raw(fd, 'profitMargins');
      info.debtToEquity = raw(fd, 'debtToEquity');
      info.currentRatio = raw(fd, 'currentRatio');
      info.beta = firstNum(raw(sd, 'beta'), raw(ks, 'beta'));
      info.marketCap = firstNum(raw(price, 'marketCap'), raw(sd, 'marketCap'));
      info.trailingEps = raw(ks, 'trailingEps');
      info.bookValue = raw(ks, 'bookValue');
      info.freeCashflow = raw(fd, 'freeCashflow');
      info.sharesOutstanding = raw(ks, 'sharesOutstanding');
      info.heldPercentInsiders = firstNum(raw(ks, 'heldPercentInsiders'), raw(mh, 'insidersPercentHeld'));
      info.heldPercentInstitutions = firstNum(raw(ks, 'heldPercentInstitutions'), raw(mh, 'institutionsPercentHeld'));
      info.dividendYield = raw(sd, 'dividendYield');
      info.fiftyTwoWeekHigh = firstNum(raw(sd, 'fiftyTwoWeekHigh'), info.fiftyTwoWeekHigh);
      info.fiftyTwoWeekLow = firstNum(raw(sd, 'fiftyTwoWeekLow'), info.fiftyTwoWeekLow);
      return info;
    } catch (e) {
      return emptyInfo(ticker, meta);
    }
  }

  async function loadAll(ticker) {
    const chart = await fetchYahooChart(ticker);
    const info = await tryFundamentals(ticker, chart.meta);
    if (chart.meta && chart.meta.regularMarketPrice != null) {
      info.currentPrice = chart.meta.regularMarketPrice;
    }
    return { history: chart.history, info, meta: chart.meta };
  }

  return { normalizeTicker, loadAll };
})();
