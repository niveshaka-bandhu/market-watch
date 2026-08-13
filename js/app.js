// ========== PASTE YOUR APPS SCRIPT WEB APP URL HERE ==========
const SHEETS_API = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
// ============================================================

const App = (() => {
  let state = {
    ticker: '',
    rawInput: '',
    df: null,
    info: {},
    verdict: null,
    showBollinger: true,
    fibEnabled: false,
    chartTimeframe: 'D',
    view: 'market',
    sheet: null
  };
  let equityIndex = [];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const show = (el) => el && el.classList.remove('hidden');
  const hide = (el) => el && el.classList.add('hidden');

  function formatINR(n) {
    if (n == null || isNaN(n)) return '—';
    return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function fmt(n, d) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: d == null ? 2 : d });
  }

  // ---------- Sheets JSONP ----------
  function sheetsJsonp(params) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const q = Object.keys(params)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');
      const s = document.createElement('script');
      const t = setTimeout(() => {
        cleanup();
        reject(new Error('Sheets timeout'));
      }, 60000);
      function cleanup() {
        clearTimeout(t);
        // Leave a harmless no-op in place instead of deleting the callback.
        // If the Apps Script response arrives after we've already timed out
        // (slow lock/poll on the server), the <script> tag will still try to
        // invoke window[cb] — deleting it caused an uncaught ReferenceError.
        window[cb] = function () {};
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = (data) => {
        cleanup();
        resolve(data);
      };
      s.onerror = () => {
        cleanup();
        reject(new Error('Sheets network error'));
      };
      s.src = SHEETS_API + '?' + q + '&callback=' + cb;
      document.body.appendChild(s);
    });
  }

  const EQUITY_CACHE_KEY = 'quantVerdict.equityIndex.v1';
  const EQUITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  function readEquityCache() {
    try {
      const raw = localStorage.getItem(EQUITY_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.data) || !parsed.data.length) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeEquityCache(data) {
    try {
      localStorage.setItem(
        EQUITY_CACHE_KEY,
        JSON.stringify({ data, ts: Date.now() })
      );
    } catch (e) {
      // storage full/unavailable — not fatal, just skip caching
    }
  }

  async function fetchEquityListFresh() {
    const res = await sheetsJsonp({ action: 'equity' });
    if (res && res.ok && Array.isArray(res.data) && res.data.length) {
      equityIndex = res.data;
      writeEquityCache(res.data);
      console.log('Equity loaded (network):', equityIndex.length);
    }
  }

  async function loadEquityList() {
    // Serve instantly from cache if we have one, even if slightly stale —
    // search should never block page load on a ~2000-row network fetch.
    const cached = readEquityCache();
    if (cached) {
      equityIndex = cached.data;
      console.log('Equity loaded (cache):', equityIndex.length);
      const age = Date.now() - (cached.ts || 0);
      if (age > EQUITY_CACHE_TTL_MS) {
        // Stale — refresh quietly in the background, don't block the caller.
        fetchEquityListFresh().catch((e) => console.warn('Equity refresh failed', e));
      }
      return;
    }
    try {
      await fetchEquityListFresh();
    } catch (e) {
      console.warn('Equity list failed', e);
    }
  }

  function setupSearch() {
    const input = $('#ticker-input');
    const box = $('#search-suggest');
    if (!input || !box) return;

    let activeIdx = -1;

    function hideBox() {
      box.hidden = true;
      box.innerHTML = '';
      activeIdx = -1;
    }

    function showHits(hits) {
      if (!hits.length) {
        hideBox();
        return;
      }
      box.innerHTML = hits
        .map(
          (h, i) =>
            '<div class="sug-item" data-idx="' +
            i +
            '" data-sym="' +
            h.symbol +
            '">' +
            '<span class="sug-name">' +
            (h.name || h.symbol) +
            '</span>' +
            '<span class="sug-sym">' +
            h.symbol +
            '</span></div>'
        )
        .join('');
      box.hidden = false;
      activeIdx = -1;

      box.querySelectorAll('.sug-item').forEach((el) => {
        el.onmousedown = (e) => {
          e.preventDefault(); // keep focus flow clean
          pick(el.getAttribute('data-sym'));
        };
      });
    }

    function pick(sym) {
      input.value = sym;
      hideBox();
      input.focus();
    }

    function filter(q) {
      q = (q || '').trim().toLowerCase();
      if (!q || !equityIndex.length) return [];
      const starts = [];
      const contains = [];
      for (let i = 0; i < equityIndex.length; i++) {
        const x = equityIndex[i];
        const sym = (x.symbol || '').toLowerCase();
        const name = (x.name || '').toLowerCase();
        if (sym === q) {
          starts.unshift(x);
          continue;
        }
        if (sym.indexOf(q) === 0 || name.indexOf(q) === 0) starts.push(x);
        else if (sym.indexOf(q) >= 0 || name.indexOf(q) >= 0) contains.push(x);
        if (starts.length + contains.length > 40) break;
      }
      return starts.concat(contains).slice(0, 15);
    }

    input.addEventListener('input', () => {
      showHits(filter(input.value));
    });

    input.addEventListener('keydown', (e) => {
      const items = box.querySelectorAll('.sug-item');
      if (box.hidden || !items.length) {
        if (e.key === 'Enter') return; // let global Enter handle Analyse
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        pick(items[activeIdx].getAttribute('data-sym'));
        return;
      } else if (e.key === 'Escape') {
        hideBox();
        return;
      } else {
        return;
      }
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      if (activeIdx >= 0) items[activeIdx].scrollIntoView({ block: 'nearest' });
    });

    document.addEventListener('click', (e) => {
      if (e.target !== input && !box.contains(e.target)) hideBox();
    });
  }

  // ---------- Apply Screener data to valuation + grids ----------
  function applySheet(d) {
    state.sheet = d;
    state.info = state.info || {};
    state.info.fundamentalsLive = true;
    state.info.trailingEps = d.trailingEps;
    state.info.bookValue = d.bookValue;
    state.info.freeCashflow = d.freeCashflowCr != null ? d.freeCashflowCr * 1e7 : null;
    state.info.sharesOutstanding = d.sharesOutstandingCr != null ? d.sharesOutstandingCr * 1e7 : null;
    state.info.returnOnEquity =
      d.roe && d.roe.last != null ? d.roe.last / 100 : d.roe && d.roe.y10 != null ? d.roe.y10 / 100 : null;
    state.info.operatingMargins =
      d.opmTtm != null ? (d.opmTtm > 1 ? d.opmTtm / 100 : d.opmTtm) : null;
    state.info.heldPercentInsiders = d.promoters != null ? d.promoters / 100 : null;
    if (d.fiis != null || d.diis != null) {
      state.info.heldPercentInstitutions = ((d.fiis || 0) + (d.diis || 0)) / 100;
    }
    // Debt/Equity rough: borrowings / (equity+reserves)
    if (d.borrowingsCr != null && d.equityCapitalCr != null && d.reservesCr != null) {
      const eq = d.equityCapitalCr + d.reservesCr;
      if (eq > 0) state.info.debtToEquity = (d.borrowingsCr / eq) * 100;
    }
  }

  function renderSheetDashboard(d) {
    let host = $('#sheet-dashboard');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sheet-dashboard';
      const main = $('#view-market') || $('#main-content');
      if (main) main.appendChild(host);
    }
    if (!d) {
      host.innerHTML = '';
      return;
    }

    function htmlTable(title, table) {
      if (!table || !table.rows || !table.rows.length) return '';
      const headers = table.headers || [];
      // Find useful header columns (skip empty leading)
      let startC = 0;
      for (let c = 0; c < headers.length; c++) {
        if (headers[c]) {
          startC = c;
          break;
        }
      }
      let headHtml = '<th>Particulars</th>';
      for (let c = Math.max(startC, 2); c < headers.length; c++) {
        if (headers[c]) headHtml += '<th>' + headers[c] + '</th>';
      }
      const body = table.rows
        .map((row) => {
          let tds = '<td>' + (row.label || '') + '</td>';
          const cells = row.cells || [];
          for (let c = Math.max(startC, 2); c < headers.length; c++) {
            if (!headers[c]) continue;
            tds += '<td>' + (cells[c] != null && cells[c] !== '' ? cells[c] : '—') + '</td>';
          }
          return '<tr>' + tds + '</tr>';
        })
        .join('');
      return (
        '<div class="card" style="margin-top:14px;overflow-x:auto">' +
        '<h3>' +
        title +
        '</h3>' +
        '<table class="data-table"><thead><tr>' +
        headHtml +
        '</tr></thead><tbody>' +
        body +
        '</tbody></table></div>'
      );
    }

    const sn = d.snapshot || {};
    const g = d.salesGrowth || {};
    const pg = d.profitGrowth || {};
    const roe = d.roe || {};
    const pc = d.priceCagr || {};
    const t = d.tables || {};

    function card(label, val) {
      return (
        '<div class="metric-card"><div class="label">' +
        label +
        '</div><div class="value" style="font-size:15px">' +
        val +
        '</div></div>'
      );
    }

    // Only render a card when the value is actually present — per request,
    // no "—" placeholders for missing fields, the card just doesn't appear.
    function cardIfPresent(label, val, suffix) {
      if (val == null || val === '') return '';
      return card(label, val + (suffix || ''));
    }

    // Wraps a title + a set of cards; if every card came back empty (none of
    // the underlying fields were present), the whole section — title
    // included — is omitted rather than showing an empty header.
    function section(title, cards) {
      const html = cards.filter(Boolean).join('');
      if (!html) return '';
      return (
        '<div class="section-title" style="margin-top:16px">' + title + '</div>' +
        '<div class="metrics-row">' + html + '</div>'
      );
    }

    function growthTable(g, pg, pc, roe) {
      // Rows line up with the sheet's own period labels: Sales/Profit use
      // "TTM" for the most recent period, Price CAGR uses "1 Year", ROE
      // uses "Last Year" — same underlying row, different label per metric.
      const periods = [
        { label: '10 Years', sales: g.y10, profit: pg.y10, price: pc.y10, roe: roe.y10 },
        { label: '5 Years', sales: g.y5, profit: pg.y5, price: pc.y5, roe: roe.y5 },
        { label: '3 Years', sales: g.y3, profit: pg.y3, price: pc.y3, roe: roe.y3 },
        { label: 'TTM / 1Y / Last Yr', sales: g.ttm, profit: pg.ttm, price: pc.y1, roe: roe.last }
      ];
      const cell = (v) => (v != null ? v + '%' : '');
      const rows = periods
        .filter((p) => p.sales != null || p.profit != null || p.price != null || p.roe != null)
        .map(
          (p) =>
            '<tr><td>' + p.label + '</td><td>' + cell(p.sales) + '</td><td>' +
            cell(p.profit) + '</td><td>' + cell(p.price) + '</td><td>' + cell(p.roe) + '</td></tr>'
        )
        .join('');
      if (!rows) return '';
      return (
        '<div class="card" style="margin-top:14px;overflow-x:auto">' +
        '<h3>Compounded Growth</h3>' +
        '<table class="data-table"><thead><tr><th>Period</th><th>Sales Growth</th>' +
        '<th>Profit Growth</th><th>Stock Price CAGR</th><th>Return on Equity</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>'
      );
    }

    function duPontTable(dp) {
      if (!dp) return '';
      const rows2 =
        '<tr><td>Net Profit Margin</td><td>' + dp.netMargin.toFixed(2) + '%</td></tr>' +
        '<tr><td>Asset Turnover</td><td>' + dp.assetTurnover.toFixed(2) + '×</td></tr>' +
        '<tr><td>Equity Multiplier (leverage)</td><td>' + dp.equityMultiplier.toFixed(2) + '×</td></tr>' +
        '<tr><td><strong>Computed ROE</strong></td><td><strong>' + dp.computedRoe.toFixed(2) + '%</strong></td></tr>' +
        (dp.reportedRoe != null
          ? '<tr><td>Screener-reported ROE</td><td>' + dp.reportedRoe + '%</td></tr>'
          : '');
      return (
        '<div class="card" style="margin-top:14px;overflow-x:auto">' +
        '<h3>DuPont ROE Decomposition</h3>' +
        '<p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">' +
        'Breaks ROE into margin, efficiency, and leverage — shows what\'s actually driving it.' +
        '</p>' +
        '<table class="data-table"><tbody>' + rows2 + '</tbody></table></div>'
      );
    }

    function piotroskiTable(pt) {
      if (!pt) return '';
      const rows3 = pt.checks
        .filter((c) => c.pass !== null)
        .map(
          (c) =>
            '<tr><td>' + c.label + '</td><td style="color:' +
            (c.pass ? 'var(--green)' : 'var(--red)') + '">' + (c.pass ? '✓ Pass' : '✗ Fail') + '</td></tr>'
        )
        .join('');
      return (
        '<div class="card" style="margin-top:14px;overflow-x:auto">' +
        '<h3>Piotroski F-Score: ' + pt.score + ' / ' + pt.max + '</h3>' +
        '<p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">' +
        (pt.max < 9
          ? (9 - pt.max) + ' of the 9 standard criteria couldn\'t be evaluated (Screener doesn\'t report that row for this company) and are excluded rather than counted as fails. '
          : '') +
        'Fundamental quality checklist — higher is stronger.' +
        '</p>' +
        '<table class="data-table"><tbody>' + rows3 + '</tbody></table></div>'
      );
    }

    function ratiosTable(ratios) {
      if (!ratios.length) return '';
      const rows4 = ratios.map((r) => '<tr><td>' + r.label + '</td><td>' + r.val + '</td></tr>').join('');
      return (
        '<div class="card" style="margin-top:14px;overflow-x:auto">' +
        '<h3>Additional Valuation Ratios</h3>' +
        '<table class="data-table"><tbody>' + rows4 + '</tbody></table></div>'
      );
    }

    const dupont = duPontAnalysis(d, sn);
    const piotroski = piotroskiFScore(d);
    const extraRatios = advancedRatios(d, sn);

    host.innerHTML =
      '<div style="margin-top:8px">' +
      '<div class="card">' +
      '<h3>' +
      (d.ticker || '') +
      ' — Overview</h3>' +
      (d.about
        ? '<p style="font-size:13px;color:var(--text-muted);line-height:1.5;margin:8px 0 14px">' +
          d.about +
          '</p>'
        : '') +
      '<div class="two-col">' +
      '<div><strong style="color:var(--green)">Pros</strong><ul class="bull-list">' +
      (d.pros || []).map((p) => '<li>' + p + '</li>').join('') +
      '</ul></div>' +
      '<div><strong style="color:var(--red)">Cons</strong><ul class="bear-list">' +
      (d.cons || []).map((c) => '<li>' + c + '</li>').join('') +
      '</ul></div></div>' +
      section('Company Info', [
        cardIfPresent('Market Cap', sn.marketCapCr != null ? '₹' + fmt(sn.marketCapCr, 0) + ' Cr.' : null),
        cardIfPresent('Current Price', sn.currentPrice != null ? '₹' + fmt(sn.currentPrice) : null),
        cardIfPresent('High / Low', sn.highLow),
        cardIfPresent('Stock P/E', sn.stockPE != null ? fmt(sn.stockPE) : null),
        cardIfPresent('Book Value', sn.bookValue != null ? '₹' + fmt(sn.bookValue) : null),
        cardIfPresent('Dividend Yield', sn.dividendYield, '%'),
        cardIfPresent('ROCE', sn.roce, '%'),
        cardIfPresent('ROE', sn.roe, '%'),
        cardIfPresent('Face Value', sn.faceValue != null ? '₹' + fmt(sn.faceValue) : null)
      ]) +
      section('Key metrics', [
        cardIfPresent('TTM EPS (₹)', d.trailingEps != null ? fmt(d.trailingEps) : null),
        cardIfPresent('Book Value (₹)', d.bookValue != null ? fmt(d.bookValue) : null),
        cardIfPresent('FCF (₹ Cr)', d.freeCashflowCr != null ? fmt(d.freeCashflowCr, 0) : null),
        cardIfPresent('Shares (Cr)', d.sharesOutstandingCr != null ? fmt(d.sharesOutstandingCr, 2) : null),
        cardIfPresent('Sales TTM (₹ Cr)', d.salesTtmCr != null ? fmt(d.salesTtmCr, 0) : null),
        cardIfPresent('PAT TTM (₹ Cr)', d.patTtmCr != null ? fmt(d.patTtmCr, 0) : null),
        cardIfPresent('OPM', d.opmTtm, '%'),
        cardIfPresent('ROCE', d.roce, '%')
      ]) +
      '</div>' +
      growthTable(g, pg, pc, roe) +
      duPontTable(dupont) +
      piotroskiTable(piotroski) +
      ratiosTable(extraRatios) +
      htmlTable('Quarterly results', t.quarterly) +
      htmlTable('Profit & Loss', t.profitLoss) +
      htmlTable('Balance Sheet', t.balanceSheet) +
      htmlTable('Cash Flow', t.cashFlow) +
      htmlTable('Ratios', t.ratios) +
      htmlTable('Shareholding Pattern', t.shareholding) +
      '</div>';
  }

  function parseNum(v) {
    if (v == null) return null;
    const s = String(v).replace(/[,%₹]/g, '').replace(/Cr\.?/gi, '').replace(/Rs\.?/gi, '').trim();
    if (s === '' || s === '-' || s === '--') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function tableRow(table, labelPart) {
    if (!table || !table.rows) return null;
    const lp = labelPart.toLowerCase();
    return table.rows.find((r) => (r.label || '').toLowerCase().indexOf(lp) >= 0) || null;
  }

  // Last `count` numeric values for a labeled row (oldest→newest), e.g.
  // latestValues(balanceSheet, 'total assets', 2) -> [prevYear, latestYear].
  function latestValues(table, labelPart, count) {
    const row = tableRow(table, labelPart);
    if (!row) return [];
    const nums = row.cells.map(parseNum).filter((v) => v != null);
    return nums.slice(-count);
  }

  function duPontAnalysis(d, sn) {
    if (d.patTtmCr == null || d.salesTtmCr == null || d.totalAssetsCr == null) return null;
    const equity = (d.equityCapitalCr || 0) + (d.reservesCr || 0);
    if (!equity || !d.totalAssetsCr) return null;
    const netMargin = d.patTtmCr / d.salesTtmCr;
    const assetTurnover = d.salesTtmCr / d.totalAssetsCr;
    const equityMultiplier = d.totalAssetsCr / equity;
    const computedRoe = netMargin * assetTurnover * equityMultiplier * 100;
    return {
      netMargin: netMargin * 100,
      assetTurnover,
      equityMultiplier,
      computedRoe,
      reportedRoe: sn.roe != null ? sn.roe : null
    };
  }

  function piotroskiFScore(d) {
    const t = d.tables || {};
    const pl = t.profitLoss;
    const bs = t.balanceSheet;
    const cf = t.cashFlow;
    const rt = t.ratios;

    const checks = [];
    function add(label, pass) {
      // pass === null means "not enough data to evaluate" — excluded from
      // the score rather than counted as a fail, so missing Screener rows
      // don't silently drag the score down.
      checks.push({ label, pass });
    }

    add('Positive net profit (TTM)', d.patTtmCr != null ? d.patTtmCr > 0 : null);
    add('Positive operating cash flow', d.cfoCr != null ? d.cfoCr > 0 : null);
    add('CFO exceeds net profit (earnings quality)',
      d.cfoCr != null && d.patTtmCr != null ? d.cfoCr > d.patTtmCr : null);

    const ta = latestValues(bs, 'total assets', 2);
    const np = latestValues(pl, 'net profit', 2);
    add('ROA improved vs prior year',
      ta.length === 2 && np.length === 2 && ta[0] && ta[1]
        ? np[1] / ta[1] > np[0] / ta[0]
        : null);

    const borrow = latestValues(bs, 'borrowings', 2);
    add('Leverage (borrowings/assets) reduced vs prior year',
      borrow.length === 2 && ta.length === 2 && ta[0] && ta[1]
        ? borrow[1] / ta[1] < borrow[0] / ta[0]
        : null);

    const curRatio = latestValues(rt, 'current ratio', 2);
    add('Current ratio improved vs prior year',
      curRatio.length === 2 ? curRatio[1] > curRatio[0] : null);

    const eqCap = latestValues(bs, 'equity capital', 2);
    add('No new equity dilution vs prior year',
      eqCap.length === 2 ? eqCap[1] <= eqCap[0] : null);

    const opm = latestValues(pl, 'opm', 2);
    add('Operating margin improved vs prior year',
      opm.length === 2 ? opm[1] > opm[0] : null);

    const sales = latestValues(pl, 'sales', 2);
    add('Asset turnover improved vs prior year',
      sales.length === 2 && ta.length === 2 && ta[0] && ta[1]
        ? sales[1] / ta[1] > sales[0] / ta[0]
        : null);

    const evaluated = checks.filter((c) => c.pass !== null);
    if (!evaluated.length) return null;
    const score = evaluated.filter((c) => c.pass).length;
    return { score, max: evaluated.length, checks };
  }

  function advancedRatios(d, sn) {
    const out = [];
    const growthForPeg = d.profitGrowth && d.profitGrowth.y5 != null ? d.profitGrowth.y5 : null;
    if (sn.stockPE != null && growthForPeg != null && growthForPeg > 0) {
      out.push({ label: 'PEG Ratio (5Y profit growth)', val: (sn.stockPE / growthForPeg).toFixed(2) });
    }
    if (d.freeCashflowCr != null && sn.marketCapCr != null && sn.marketCapCr > 0) {
      out.push({ label: 'FCF Yield', val: ((d.freeCashflowCr / sn.marketCapCr) * 100).toFixed(2) + '%' });
    }
    if (sn.stockPE != null && sn.stockPE > 0) {
      out.push({ label: 'Earnings Yield', val: ((1 / sn.stockPE) * 100).toFixed(2) + '%' });
    }
    return out;
  }

  function drawPriceChart() {
    if (!state.df || typeof Charts === 'undefined') return;
    const data = Indicators.aggregateOHLC(state.df, state.chartTimeframe);
    const fib = state.fibEnabled ? Indicators.fibonacciLevels(data, 130) : null;
    Charts.priceChart(data, state.showBollinger, fib);
  }

  function renderRiskMetrics(df) {
    const host = $('#risk-metrics-row');
    if (!host) return;
    const m = Indicators.riskMetrics(df);
    if (!m) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Not enough price history for risk analytics.</p>';
      return;
    }
    function card(label, val, cls) {
      return (
        '<div class="metric-card"><div class="label">' + label + '</div>' +
        '<div class="value" style="font-size:17px' + (cls ? ';' + cls : '') + '">' + val + '</div></div>'
      );
    }
    host.innerHTML =
      card('Annualized Return', m.annualReturn.toFixed(1) + '%', 'color:' + (m.annualReturn >= 0 ? 'var(--green)' : 'var(--red)')) +
      card('Annualized Volatility', m.annualVol.toFixed(1) + '%') +
      card('Sharpe Ratio (Rf 7%)', m.sharpe != null ? m.sharpe.toFixed(2) : '—') +
      card('Max Drawdown', m.maxDrawdown.toFixed(1) + '%', 'color:var(--red)') +
      card('Best Day', '+' + m.bestDay.toFixed(1) + '%', 'color:var(--green)') +
      card('Worst Day', m.worstDay.toFixed(1) + '%', 'color:var(--red)');
  }

  // ---------- Market view ----------
  function renderMarketView() {
    const v = state.verdict;
    // Screener-only path (no Yahoo chart)
    if (!v || !v.latest) {
      const box = $('#verdict-box');
      if (box) {
        box.className = 'verdict-box neutral';
        box.innerHTML =
          '<h2>Fundamentals loaded</h2><p>Price chart / technical verdict unavailable. Use valuation and tables below.</p>';
      }
      renderValuationWidgets(null);
      renderSheetDashboard(state.sheet);
      return;
    }
    const last = v.latest;
    const prev = v.prev || last;

    const box = $('#verdict-box');
    box.className = 'verdict-box ' + v.cssClass;
    box.innerHTML =
      '<h2>🔍 SYSTEM DISPATCH: ' +
      v.master +
      '</h2><p><strong>Executive Summary:</strong> ' +
      v.summary +
      '</p>';

    $('#bull-list').innerHTML = v.bull.length
      ? v.bull.map((p) => '<li>' + p + '</li>').join('')
      : '<li>No distinct positive signals.</li>';
    $('#bear-list').innerHTML = v.bear.length
      ? v.bear.map((p) => '<li>' + p + '</li>').join('')
      : '<li>No severe risk vectors.</li>';

    const livePx =
      state.info && state.info.currentPrice != null ? state.info.currentPrice : last.close;
    const basePx =
      state.info && state.info.previousClose != null ? state.info.previousClose : prev.close;
    const chg = livePx - basePx;
    const pct = basePx ? (chg / basePx) * 100 : 0;
    $('#m-price').textContent = formatINR(livePx);
    $('#m-delta').textContent =
      (chg >= 0 ? '+' : '') + chg.toFixed(2) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)';
    $('#m-delta').className = 'delta ' + (chg >= 0 ? 'positive' : 'negative');
    $('#m-rsi').textContent = last.rsi != null ? last.rsi.toFixed(1) : '—';
    $('#m-macd').textContent = last.macdHist != null ? last.macdHist.toFixed(2) : '—';
    $('#m-bull').textContent = (v.bullRatio * 100).toFixed(1) + '%';

    if (state.df) drawPriceChart();
    renderRiskMetrics(state.df);
    const piv = Indicators.pivots(last);
    $('#pivot-r2').textContent = formatINR(piv.r2);
    $('#pivot-r1').textContent = formatINR(piv.r1);
    $('#pivot-central').textContent = formatINR(piv.pivot);
    $('#pivot-s1').textContent = formatINR(piv.s1);
    $('#pivot-s2').textContent = formatINR(piv.s2);
    $('#pivot-atr').textContent = formatINR(piv.atr);

    renderValuationWidgets(last);
    renderSheetDashboard(state.sheet);
  }

  function renderValuationWidgets(last) {
    const info = state.info || {};
    const d = state.sheet || {};
    const epsEl = $('#graham-eps');
    const bvEl = $('#graham-bvps');
    const gfEpsEl = $('#gf-eps');
    const gfGrowthEl = $('#gf-growth');
    const plEpsEl = $('#pl-eps');
    const plGrowthEl = $('#pl-growth');
    if (!epsEl) return;

    // Prefer Screener numbers
    if (d.trailingEps != null) epsEl.value = Number(d.trailingEps).toFixed(2);
    else if (info.trailingEps != null) epsEl.value = Number(info.trailingEps).toFixed(2);

    if (d.bookValue != null) bvEl.value = Number(d.bookValue).toFixed(2);
    else if (info.bookValue != null) bvEl.value = Number(info.bookValue).toFixed(2);

    function updateGraham() {
      const eps = parseFloat(epsEl.value) || 0;
      const bv = parseFloat(bvEl.value) || 0;
      if (eps > 0 && bv > 0) {
        $('#graham-result').innerHTML =
          'Calculated Graham Number: <strong>' + formatINR(Math.sqrt(22.5 * eps * bv)) + '</strong>';
      } else $('#graham-result').textContent = 'Enter EPS and BVPS from Screener';
    }
    epsEl.oninput = bvEl.oninput = updateGraham;
    updateGraham();

    // Default growth rate to Screener's TTM sales growth when available.
    const defaultGrowth =
      d.salesGrowth && d.salesGrowth.ttm != null ? d.salesGrowth.ttm : 12;

    if (gfEpsEl) {
      if (d.trailingEps != null) gfEpsEl.value = Number(d.trailingEps).toFixed(2);
      else if (info.trailingEps != null) gfEpsEl.value = Number(info.trailingEps).toFixed(2);
    }
    if (gfGrowthEl && !gfGrowthEl.value) gfGrowthEl.value = defaultGrowth;

    if (plEpsEl) {
      if (d.trailingEps != null) plEpsEl.value = Number(d.trailingEps).toFixed(2);
      else if (info.trailingEps != null) plEpsEl.value = Number(info.trailingEps).toFixed(2);
    }
    if (plGrowthEl && !plGrowthEl.value) plGrowthEl.value = defaultGrowth;

    function updateGrahamFormula() {
      if (!gfEpsEl || !gfGrowthEl) return;
      const eps = parseFloat(gfEpsEl.value) || 0;
      const g = parseFloat(gfGrowthEl.value) || 0;
      const v = eps * (8.5 + 2 * g);
      if (eps > 0 && v > 0) {
        $('#gf-result').innerHTML =
          'Graham Formula Fair Value: <strong>' + formatINR(v) + '</strong>';
      } else if (eps > 0) {
        $('#gf-result').textContent = 'Not meaningful — growth rate too negative for this formula';
      } else {
        $('#gf-result').textContent = 'Enter EPS from Screener';
      }
    }
    if (gfEpsEl && gfGrowthEl) {
      gfEpsEl.oninput = gfGrowthEl.oninput = updateGrahamFormula;
      updateGrahamFormula();
    }

    function updateLynch() {
      if (!plEpsEl || !plGrowthEl) return;
      const eps = parseFloat(plEpsEl.value) || 0;
      const g = parseFloat(plGrowthEl.value) || 0;
      if (eps > 0) {
        $('#pl-result').innerHTML =
          'Peter Lynch Fair Value: <strong>' + formatINR(eps * g) + '</strong>';
      } else {
        $('#pl-result').textContent = 'Enter EPS from Screener';
      }
    }
    if (plEpsEl && plGrowthEl) {
      plEpsEl.oninput = plGrowthEl.oninput = updateLynch;
      updateLynch();
    }

    const note = $('#fundamentals-note');
    if (note) {
      note.textContent = state.sheet
        ? 'Fundamentals loaded'
        : 'Enter values or run Analyse';
      note.style.color = state.sheet ? 'var(--green)' : 'var(--yellow)';
    }
  }

  function renderQuantView() {
    const info = state.info || {};
    const d = state.sheet || {};
    const fmtPct = (v) => (v != null && !isNaN(v) ? (v * 100).toFixed(2) + '%' : '—');
    const rows = [
      ['ROE (Screener last yr)', d.roe && d.roe.last != null ? d.roe.last + '%' : fmtPct(info.returnOnEquity), '> 15%'],
      ['ROCE', d.roce != null ? d.roce + '%' : '—', '—'],
      ['OPM TTM', d.opmTtm != null ? d.opmTtm + '%' : '—', '> 12%'],
      ['Debt / Equity (calc)', info.debtToEquity != null ? (info.debtToEquity / 100).toFixed(2) : '—', '< 1'],
      ['Promoters', d.promoters != null ? d.promoters + '%' : '—', '—'],
      ['FII + DII', d.fiis != null || d.diis != null ? ((d.fiis || 0) + (d.diis || 0)).toFixed(2) + '%' : '—', '—']
    ];
    const body = $('#quality-body');
    if (body) {
      body.innerHTML = rows
        .map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>')
        .join('');
    }
    const shEl = $('#shareholding-row');
    if (shEl) {
      shEl.innerHTML =
        '<div class="metric-card"><div class="label">Promoters</div><div class="value" style="font-size:16px">' +
        (d.promoters != null ? d.promoters + '%' : '—') +
        '</div></div>' +
        '<div class="metric-card"><div class="label">FII</div><div class="value" style="font-size:16px">' +
        (d.fiis != null ? d.fiis + '%' : '—') +
        '</div></div>' +
        '<div class="metric-card"><div class="label">DII</div><div class="value" style="font-size:16px">' +
        (d.diis != null ? d.diis + '%' : '—') +
        '</div></div>';
    }
    runMonteCarlo();
    const btn = $('#run-backtest');
    if (btn) btn.onclick = runBacktest;
  }

  function runMonteCarlo() {
    const df = state.df;
    if (!df || !df.length || typeof Charts === 'undefined') return;
    const last = df[df.length - 1];
    const returns = df.map((r) => r.dailyReturn).filter((v) => v != null);
    let vol = 0.015;
    if (returns.length > 10) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      vol = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length) || 0.015;
    }
    const days = 30,
      sims = 100;
    const matrix = Array.from({ length: days }, () => new Array(sims));
    for (let s = 0; s < sims; s++) matrix[0][s] = last.close;
    for (let d = 1; d < days; d++) {
      for (let s = 0; s < sims; s++) {
        const shock = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * vol;
        matrix[d][s] = matrix[d - 1][s] * Math.exp(shock);
      }
    }
    Charts.monteCarloChart(matrix);
  }

  function runBacktest() {
    const strategy = $('#bt-strategy').value;
    const capital = parseFloat($('#bt-capital').value) || 100000;
    const df = (state.df || []).filter((r) =>
      strategy === 'sma' ? r.sma50 != null && r.sma200 != null : r.macd != null && r.signal != null
    );
    if (df.length < 10) {
      $('#bt-result').textContent = 'Insufficient data';
      return;
    }
    let pos = 0,
      cash = capital,
      shares = 0;
    const equity = [],
      dates = [];
    for (const row of df) {
      const buy = strategy === 'sma' ? row.sma50 > row.sma200 : row.macd > row.signal;
      if (pos === 0 && buy) {
        shares = cash / row.close;
        cash = 0;
        pos = 1;
      } else if (pos === 1 && !buy) {
        cash = shares * row.close;
        shares = 0;
        pos = 0;
      }
      equity.push(cash + shares * row.close);
      dates.push(row.date);
    }
    const first = df[0].close;
    Charts.backtestChart(
      dates,
      equity,
      df.map((r) => (capital / first) * r.close)
    );
    $('#bt-result').innerHTML =
      'Strategy Terminal Worth: <strong>' + formatINR(equity[equity.length - 1]) + '</strong>';
  }

  // ---------- Load ----------
  async function loadTicker() {
    const raw = ($('#ticker-input').value || '').trim().toUpperCase();
    if (!raw) return;
    if (!SHEETS_API || SHEETS_API.indexOf('YOUR_DEPLOYMENT') >= 0) {
      alert('Set SHEETS_API in js/app.js to your Apps Script deploy URL');
      return;
    }

    state.rawInput = raw;
    state.ticker = DataService.normalizeTicker(raw);
    state.showBollinger = $('#show-bb') ? $('#show-bb').checked : true;
    state.chartTimeframe = 'D';
    const dayRadio = document.querySelector('input[name="chart-tf"][value="D"]');
    if (dayRadio) dayRadio.checked = true;
    state.sheet = null;
    // Clear valuation calculator inputs so a stale value from the previous
    // ticker (or a failed first-load fallback) can never block this
    // ticker's auto-fill — see renderValuationWidgets' "!el.value" checks.
    ['#graham-eps', '#graham-bvps', '#gf-eps', '#gf-growth', '#pl-eps', '#pl-growth'].forEach((sel) => {
      const el = $(sel);
      if (el) el.value = '';
    });

    hide($('#main-content'));
    hide($('#error-box'));
    show($('#loading'));
    const loadMsg = $('#loading');
    if (loadMsg) loadMsg.innerHTML = '<div class="spinner"></div><div>Loading…</div>';

    try {
      // Parallel: Yahoo chart + Sheets Screener
      const chartPromise = DataService.loadAll(state.ticker);
      const sheetPromise = sheetsJsonp({ action: 'analyse', ticker: raw }).catch((e) => {
        console.warn(e);
        return null;
      });

      const [chartRes, sheetRes] = await Promise.all([chartPromise, sheetPromise]);

      state.info = chartRes.info || {};
      if (chartRes.history && chartRes.history.length >= 30) {
        state.df = Indicators.calculateAll(chartRes.history);
        state.verdict = VerdictEngine.analyse(state.df, state.info);
      } else {
        state.df = null;
        state.verdict = null;
      }

      if (sheetRes && sheetRes.ok && sheetRes.data) {
        applySheet(sheetRes.data);
      }

      // If no chart and no sheet, hard fail
      if (!state.df && !(sheetRes && sheetRes.ok && sheetRes.data)) {
        throw new Error(
          (chartRes && chartRes.chartError) ||
            'Could not load price or fundamental data. Try again.'
        );
      }

      hide($('#loading'));
      show($('#main-content'));
      $('#asset-title').textContent = 'Strategic Asset Intelligence Center (' + state.rawInput + ')';

      if (state.view === 'market') {
        show($('#view-market'));
        hide($('#view-quant'));
        renderMarketView();
      } else {
        hide($('#view-market'));
        show($('#view-quant'));
        renderQuantView();
      }

      // Soft warning if chart missing but Screener OK
      if (!state.df && state.sheet) {
        const box = $('#error-box');
        box.textContent =
          'Price chart unavailable. Fundamentals and valuation still available.';
        box.classList.remove('hidden');
        show(box);
      }
    } catch (err) {
      console.error(err);
      hide($('#loading'));
      const box = $('#error-box');
      box.textContent = 'Error: ' + (err.message || err);
      show(box);
    }
  }

  function init() {
    $$('input[name="workspace"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        state.view = e.target.value;
        if (!state.df) return;
        if (state.view === 'market') {
          show($('#view-market'));
          hide($('#view-quant'));
          renderMarketView();
        } else {
          hide($('#view-market'));
          show($('#view-quant'));
          renderQuantView();
        }
      });
    });
    const bb = $('#show-bb');
    if (bb)
      bb.addEventListener('change', () => {
        state.showBollinger = bb.checked;
        if (state.view === 'market') drawPriceChart();
      });
    const fib = $('#show-fib');
    if (fib)
      fib.addEventListener('change', () => {
        state.fibEnabled = fib.checked;
        if (state.view === 'market') drawPriceChart();
      });
    $$('input[name="chart-tf"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        state.chartTimeframe = e.target.value;
        if (state.view === 'market') drawPriceChart();
      });
    });
    const input = $('#ticker-input');
    if (input) input.addEventListener('keydown', (e) => e.key === 'Enter' && loadTicker());
    const btn = $('#analyse-btn');
    if (btn) btn.addEventListener('click', loadTicker);
    $$('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        $$('.tab-btn').forEach((x) => x.classList.remove('active'));
        $$('.tab-content').forEach((c) => c.classList.remove('active'));
        b.classList.add('active');
        const tab = $('#tab-' + b.dataset.tab);
        if (tab) tab.classList.add('active');
      });
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

    loadEquityList().then(setupSearch);
    // Don't auto-load heavy analyse on first paint — wait for user (faster)
    // loadTicker();
    hide($('#loading'));
    show($('#main-content'));
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
