/**
 * Data layer – Yahoo Finance only
 * Chart (OHLCV + meta) is primary. quoteSummary attempted for fundamentals.
 */

const DataService = (() => {
  function normalizeTicker(raw) {
    let t = (raw || '').toUpperCase().trim();
    if (!t) return null;
    if (t.startsWith('^')) return t;
    if (t.includes('.')) return t;
    return t + '.NS';
  }

  async function fetchText(url) {
    const res = await fetch(url, {
      cache: 'no-store',
      mode: 'cors',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }

  async function fetchJsonMulti(urls) {
    let lastErr;
    for (const url of urls) {
      try {
        const text = await fetchText(url);
        return JSON.parse(text);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('All fetches failed');
  }

  // ---------- Chart history + meta ----------
  async function fetchYahooChart(ticker) {
    const urls = [
      'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=1d&range=5y',
      'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=1d&range=5y',
      'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=1d&range=5y')
    ];
    const json = await fetchJsonMulti(urls);
    return parseChart(json, ticker);
  }

  function parseChart(json, ticker) {
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp) throw new Error('Empty Yahoo chart for ' + ticker);
    const meta = result.meta || {};
    const ts = result.timestamp;
    const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!q) throw new Error('No OHLCV series');

    const rows = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] == null || isNaN(q.close[i])) continue;
      const d = new Date(ts[i] * 1000);
      rows.push({
        date: d.toISOString().slice(0, 10),
        open: Number(q.open[i]) || Number(q.close[i]),
        high: Number(q.high[i]) || Number(q.close[i]),
        low: Number(q.low[i]) || Number(q.close[i]),
        close: Number(q.close[i]),
        volume: Number(q.volume[i]) || 0
      });
    }
    if (rows.length < 30) throw new Error('Insufficient history');

    return { history: rows, meta: meta };
  }

  // ---------- Fundamentals via quoteSummary (may fail without crumb) ----------
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

  function emptyInfo(ticker, meta) {
    meta = meta || {};
    return {
      symbol: ticker,
      shortName: meta.shortName || ticker.replace('.NS', '').replace('.BO', ''),
      longName: meta.longName || meta.shortName || null,
      currency: meta.currency || 'INR',
      exchange: meta.fullExchangeName || meta.exchangeName || (ticker.indexOf('.BO') !== -1 ? 'BSE' : 'NSE'),
      sector: null,
      industry: null,
      website: null,
      currentPrice: meta.regularMarketPrice || null,
      previousClose: meta.chartPreviousClose || meta.previousClose || null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow || null,
      regularMarketVolume: meta.regularMarketVolume || null,
      trailingPE: null,
      forwardPE: null,
      priceToBook: null,
      pegRatio: null,
      returnOnEquity: null,
      returnOnAssets: null,
      operatingMargins: null,
      profitMargins: null,
      debtToEquity: null,
      currentRatio: null,
      beta: null,
      marketCap: null,
      enterpriseValue: null,
      trailingEps: null,
      bookValue: null,
      freeCashflow: null,
      totalCash: null,
      totalDebt: null,
      revenueGrowth: null,
      earningsGrowth: null,
      sharesOutstanding: null,
      heldPercentInsiders: null,
      heldPercentInstitutions: null,
      dividendYield: null,
      payoutRatio: null,
      averageVolume: null,
      fundamentalsLive: false,
      news: []
    };
  }

  async function fetchYahooQuoteSummary(ticker, meta) {
    const modules = 'price,summaryDetail,defaultKeyStatistics,financialData,summaryProfile,majorHoldersBreakdown';
    const urls = [
      'https://query1.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(ticker) + '?modules=' + modules,
      'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(ticker) + '?modules=' + modules
    ];
    try {
      const json = await fetchJsonMulti(urls);
      return parseQuoteSummary(json, ticker, meta);
    } catch (e) {
      console.warn('Yahoo fundamentals unavailable (crumb/CORS):', e.message || e);
      return emptyInfo(ticker, meta);
    }
  }

  function parseQuoteSummary(json, ticker, meta) {
    var r = json && json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0];
    if (!r) return emptyInfo(ticker, meta);

    var price = r.price || {};
    var sd = r.summaryDetail || {};
    var ks = r.defaultKeyStatistics || {};
    var fd = r.financialData || {};
    var sp = r.summaryProfile || {};
    var mh = r.majorHoldersBreakdown || {};

    var info = emptyInfo(ticker, meta);
    info.fundamentalsLive = true;
    info.shortName = raw(price, 'shortName') || info.shortName;
    info.longName = raw(price, 'longName') || info.longName;
    info.currency = raw(price, 'currency') || info.currency;
    info.exchange = raw(price, 'exchangeName') || info.exchange;
    info.sector = raw(sp, 'sector');
    info.industry = raw(sp, 'industry');
    info.website = raw(sp, 'website');
    info.currentPrice = raw(price, 'regularMarketPrice') || info.currentPrice;

    info.trailingPE = firstNum(raw(sd, 'trailingPE'), raw(ks, 'trailingPE'));
    info.forwardPE = firstNum(raw(sd, 'forwardPE'), raw(ks, 'forwardPE'));
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
    info.enterpriseValue = firstNum(raw(ks, 'enterpriseValue'), raw(fd, 'enterpriseValue'));
    info.trailingEps = raw(ks, 'trailingEps');
    info.bookValue = raw(ks, 'bookValue');
    info.freeCashflow = raw(fd, 'freeCashflow');
    info.totalCash = raw(fd, 'totalCash');
    info.totalDebt = raw(fd, 'totalDebt');
    info.revenueGrowth = raw(fd, 'revenueGrowth');
    info.earningsGrowth = raw(fd, 'earningsGrowth');
    info.sharesOutstanding = raw(ks, 'sharesOutstanding');
    info.heldPercentInsiders = firstNum(raw(ks, 'heldPercentInsiders'), raw(mh, 'insidersPercentHeld'));
    info.heldPercentInstitutions = firstNum(raw(ks, 'heldPercentInstitutions'), raw(mh, 'institutionsPercentHeld'));
    info.dividendYield = raw(sd, 'dividendYield');
    info.payoutRatio = raw(sd, 'payoutRatio');
    info.fiftyTwoWeekHigh = firstNum(raw(sd, 'fiftyTwoWeekHigh'), info.fiftyTwoWeekHigh);
    info.fiftyTwoWeekLow = firstNum(raw(sd, 'fiftyTwoWeekLow'), info.fiftyTwoWeekLow);
    info.averageVolume = raw(sd, 'averageVolume');
    return info;
  }

  function firstNum() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v != null && !isNaN(v)) return v;
    }
    return null;
  }

  async function loadAll(ticker) {
    const chart = await fetchYahooChart(ticker);
    const info = await fetchYahooQuoteSummary(ticker, chart.meta);
    // Always prefer live chart price
    if (chart.meta && chart.meta.regularMarketPrice != null) {
      info.currentPrice = chart.meta.regularMarketPrice;
    }
    return { history: chart.history, info: info, meta: chart.meta };
  }

  async function loadHistory(ticker) {
    const chart = await fetchYahooChart(ticker);
    return chart.history;
  }

  async function loadBasicInfo(ticker) {
    return fetchYahooQuoteSummary(ticker, {});
  }

  return {
    normalizeTicker: normalizeTicker,
    loadHistory: loadHistory,
    loadBasicInfo: loadBasicInfo,
    loadAll: loadAll
  };
})();
