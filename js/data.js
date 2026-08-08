/**
 * Data layer – ALL data from Yahoo Finance
 * Chart history + quoteSummary modules (fundamentals, profile, holdings)
 */

const DataService = (() => {
  function normalizeTicker(raw) {
    let t = (raw || '').toUpperCase().trim();
    if (!t) return null;
    if (t.startsWith('^')) return t;
    if (t.includes('.')) return t;
    return t + '.NS';
  }

  async function tryFetch(url) {
    const res = await fetch(url, {
      cache: 'no-store',
      mode: 'cors',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  }

  function proxyVariants(url) {
    return [
      url,
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
      'https://corsproxy.io/?' + encodeURIComponent(url),
      'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url)
    ];
  }

  async function fetchJson(url) {
    let lastErr;
    for (const u of proxyVariants(url)) {
      try {
        const res = await tryFetch(u);
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error('Non-JSON response');
        }
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('All Yahoo fetch attempts failed');
  }

  async function fetchYahooChart(ticker) {
    const hosts = ['query1', 'query2'];
    let lastErr;
    for (const host of hosts) {
      try {
        const url = 'https://' + host + '.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(ticker) + '?interval=1d&range=5y';
        const json = await fetchJson(url);
        return parseChart(json);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  function parseChart(json) {
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp) throw new Error('Empty Yahoo chart');
    const ts = result.timestamp;
    const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!q) throw new Error('No quote series');
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
    if (rows.length < 30) throw new Error('Insufficient history from Yahoo');
    return rows;
  }

  const MODULES = [
    'price',
    'summaryDetail',
    'defaultKeyStatistics',
    'financialData',
    'summaryProfile',
    'majorHoldersBreakdown'
  ].join(',');

  async function fetchYahooQuoteSummary(ticker) {
    const hosts = ['query1', 'query2'];
    let lastErr;
    for (const host of hosts) {
      try {
        const url = 'https://' + host + '.finance.yahoo.com/v10/finance/quoteSummary/' +
          encodeURIComponent(ticker) +
          '?modules=' + MODULES + '&corsDomain=finance.yahoo.com';
        const json = await fetchJson(url);
        return parseQuoteSummary(json, ticker);
      } catch (e) {
        lastErr = e;
      }
    }
    console.warn('quoteSummary failed:', lastErr);
    return emptyInfo(ticker);
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

  function emptyInfo(ticker) {
    return {
      symbol: ticker,
      shortName: ticker.replace('.NS', '').replace('.BO', ''),
      longName: null,
      currency: 'INR',
      exchange: ticker.indexOf('.BO') !== -1 ? 'BSE' : 'NSE',
      sector: null,
      industry: null,
      website: null,
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
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      averageVolume: null,
      news: []
    };
  }

  function parseQuoteSummary(json, ticker) {
    var r = json && json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0];
    if (!r) return emptyInfo(ticker);

    var price = r.price || {};
    var sd = r.summaryDetail || {};
    var ks = r.defaultKeyStatistics || {};
    var fd = r.financialData || {};
    var sp = r.summaryProfile || {};
    var mh = r.majorHoldersBreakdown || {};

    var info = emptyInfo(ticker);
    info.shortName = raw(price, 'shortName') || info.shortName;
    info.longName = raw(price, 'longName') || raw(price, 'shortName');
    info.currency = raw(price, 'currency') || 'INR';
    info.exchange = raw(price, 'exchangeName') || info.exchange;
    info.sector = raw(sp, 'sector');
    info.industry = raw(sp, 'industry');
    info.website = raw(sp, 'website');

    info.trailingPE = raw(sd, 'trailingPE') != null ? raw(sd, 'trailingPE') : raw(ks, 'trailingPE');
    info.forwardPE = raw(sd, 'forwardPE') != null ? raw(sd, 'forwardPE') : raw(ks, 'forwardPE');
    info.priceToBook = raw(sd, 'priceToBook') != null ? raw(sd, 'priceToBook') : raw(ks, 'priceToBook');
    info.pegRatio = raw(ks, 'pegRatio');
    info.returnOnEquity = raw(fd, 'returnOnEquity');
    info.returnOnAssets = raw(fd, 'returnOnAssets');
    info.operatingMargins = raw(fd, 'operatingMargins');
    info.profitMargins = raw(fd, 'profitMargins');
    info.debtToEquity = raw(fd, 'debtToEquity');
    info.currentRatio = raw(fd, 'currentRatio');
    info.beta = raw(sd, 'beta') != null ? raw(sd, 'beta') : raw(ks, 'beta');
    info.marketCap = raw(price, 'marketCap') != null ? raw(price, 'marketCap') : raw(sd, 'marketCap');
    info.enterpriseValue = raw(ks, 'enterpriseValue') != null ? raw(ks, 'enterpriseValue') : raw(fd, 'enterpriseValue');
    info.trailingEps = raw(ks, 'trailingEps');
    info.bookValue = raw(ks, 'bookValue');
    info.freeCashflow = raw(fd, 'freeCashflow');
    info.totalCash = raw(fd, 'totalCash');
    info.totalDebt = raw(fd, 'totalDebt');
    info.revenueGrowth = raw(fd, 'revenueGrowth');
    info.earningsGrowth = raw(fd, 'earningsGrowth');
    info.sharesOutstanding = raw(ks, 'sharesOutstanding');
    info.heldPercentInsiders = raw(ks, 'heldPercentInsiders') != null ? raw(ks, 'heldPercentInsiders') : raw(mh, 'insidersPercentHeld');
    info.heldPercentInstitutions = raw(ks, 'heldPercentInstitutions') != null ? raw(ks, 'heldPercentInstitutions') : raw(mh, 'institutionsPercentHeld');
    info.dividendYield = raw(sd, 'dividendYield');
    info.payoutRatio = raw(sd, 'payoutRatio');
    info.fiftyTwoWeekHigh = raw(sd, 'fiftyTwoWeekHigh');
    info.fiftyTwoWeekLow = raw(sd, 'fiftyTwoWeekLow');
    info.averageVolume = raw(sd, 'averageVolume');
    info.news = [];

    return info;
  }

  async function loadHistory(ticker) {
    return fetchYahooChart(ticker);
  }

  async function loadBasicInfo(ticker) {
    return fetchYahooQuoteSummary(ticker);
  }

  async function loadAll(ticker) {
    var results = await Promise.all([loadHistory(ticker), loadBasicInfo(ticker)]);
    return { history: results[0], info: results[1] };
  }

  return {
    normalizeTicker: normalizeTicker,
    loadHistory: loadHistory,
    loadBasicInfo: loadBasicInfo,
    loadAll: loadAll
  };
})();
