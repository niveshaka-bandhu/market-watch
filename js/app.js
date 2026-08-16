// ========== PASTE YOUR APPS SCRIPT WEB APP URL HERE ==========
const SHEETS_API = 'https://script.google.com/macros/s/AKfycbxgR0EC7xaqe9H0Wx9gG0pQcpl2Elb-Skoxz_Pz7wPA6N3zTckWQFyb_u6TFfFo7oux/exec';
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
    ichimokuEnabled: false,
    chartTimeframe: 'D',
    chartRange: 260,
    intradayInterval: null,
    intradayDf: null,
    fullscreenChart: false,
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

  function card(label, val) {
    return (
      '<div class="metric-card"><div class="label">' +
      label +
      '</div><div class="value" style="font-size:15px">' +
      val +
      '</div></div>'
    );
  }

  // Only render a card when the value is actually present — no "—"
  // placeholders for missing fields, the card just doesn't appear.
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

  function renderCompanyInfoTop(d) {
    const host = $('#company-info-top');
    if (!host) return;
    if (!d) {
      host.innerHTML = '';
      return;
    }
    const sn = d.snapshot || {};
    host.innerHTML = section('Company Info', [
      cardIfPresent('Market Cap', sn.marketCapCr != null ? '₹' + fmt(sn.marketCapCr, 0) + ' Cr.' : null),
      cardIfPresent('Current Price', sn.currentPrice != null ? '₹' + fmt(sn.currentPrice) : null),
      cardIfPresent('High / Low', sn.highLow),
      cardIfPresent('Stock P/E', sn.stockPE != null ? fmt(sn.stockPE) : null),
      cardIfPresent('Book Value', sn.bookValue != null ? '₹' + fmt(sn.bookValue) : null),
      cardIfPresent('Dividend Yield', sn.dividendYield, '%'),
      cardIfPresent('ROCE', sn.roce, '%'),
      cardIfPresent('ROE', sn.roe, '%'),
      cardIfPresent('Face Value', sn.faceValue != null ? '₹' + fmt(sn.faceValue) : null)
    ]);
    if (d.ticker || d.about) {
      host.innerHTML +=
        '<div style="margin-top:12px">' +
        (d.ticker ? '<h3>' + d.ticker + ' — Overview</h3>' : '') +
        (d.about
          ? '<p style="font-size:13px;color:var(--text-muted);line-height:1.5;margin:8px 0 0">' + d.about + '</p>'
          : '') +
        '</div>';
    }
  }

  async function fetchPeerData(rawTicker) {
    const res = await sheetsJsonp({ action: 'analyse', ticker: rawTicker });
    if (!res || !res.ok || !res.data) throw new Error('No data for ' + rawTicker);
    return res.data;
  }

  function peerMetricRows(entries) {
    // entries: [{label, sheet}] — label is the display ticker, sheet is the raw analyse response
    function row(label, getter, suffix) {
      const cells = entries.map((e) => {
        const v = getter(e.sheet);
        return v != null ? fmt(v) + (suffix || '') : '—';
      });
      if (cells.every((c) => c === '—')) return '';
      return '<tr><td>' + label + '</td>' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>';
    }
    const sn = (s) => s.snapshot || {};
    return [
      row('Market Cap (₹ Cr.)', (s) => sn(s).marketCapCr, ''),
      row('Current Price (₹)', (s) => sn(s).currentPrice, ''),
      row('P/E', (s) => sn(s).stockPE, ''),
      row('ROE (%)', (s) => sn(s).roe, '%'),
      row('ROCE (%)', (s) => sn(s).roce, '%'),
      row('Dividend Yield (%)', (s) => sn(s).dividendYield, '%'),
      row('Sales Growth TTM (%)', (s) => s.salesGrowth && s.salesGrowth.ttm, '%'),
      row('Profit Growth TTM (%)', (s) => s.profitGrowth && s.profitGrowth.ttm, '%'),
      row('OPM TTM (%)', (s) => s.opmTtm, '%')
    ]
      .filter(Boolean)
      .join('');
  }

  async function runPeerComparison() {
    const host = $('#peer-comparison-result');
    const btn = $('#peer-compare-btn');
    if (!host) return;
    if (!state.sheet || !state.rawInput) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Analyse a ticker first.</p>';
      return;
    }
    const peer1 = ($('#peer-1').value || '').trim().toUpperCase();
    const peer2 = ($('#peer-2').value || '').trim().toUpperCase();
    const peerTickers = [peer1, peer2].filter(Boolean);
    if (!peerTickers.length) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Enter at least one peer ticker.</p>';
      return;
    }

    const entries = [{ label: state.rawInput, sheet: state.sheet }];
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Comparing…';
    }
    host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Fetching ' + peerTickers[0] + '…</p>';

    // Sequential on purpose — the backend sheet can only hold one ticker's
    // scrape at a time, so fetching peers one after another (not in
    // parallel) respects that instead of racing against the server-side lock.
    for (let idx = 0; idx < peerTickers.length; idx++) {
      const t = peerTickers[idx];
      try {
        host.innerHTML =
          '<p style="font-size:12px;color:var(--text-muted)">Fetching ' + t +
          ' (' + (idx + 1) + '/' + peerTickers.length + ')…</p>';
        const data = await fetchPeerData(t);
        entries.push({ label: t, sheet: data });
      } catch (e) {
        console.warn('Peer fetch failed for', t, e);
        entries.push({ label: t, sheet: {} });
      }
    }

    const rows = peerMetricRows(entries);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Compare';
    }
    if (!rows) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">No comparable data returned.</p>';
      return;
    }
    host.innerHTML =
      '<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Metric</th>' +
      entries.map((e) => '<th>' + e.label + '</th>').join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  async function generatePdfReport() {
    if (typeof window.jspdf === 'undefined') {
      alert('PDF library failed to load — check your connection and try again.');
      return null;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    let y = 50;

    function ensureSpace(h) {
      if (y + h > pageH - 40) {
        doc.addPage();
        y = 50;
      }
    }
    function heading(text, size) {
      ensureSpace(size * 1.6);
      doc.setFontSize(size);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(text, margin, y);
      y += size * 1.5;
      doc.setFont(undefined, 'normal');
    }
    function para(text, size) {
      doc.setFontSize(size || 10);
      doc.setTextColor(0, 0, 0);
      const lines = doc.splitTextToSize(text, pageW - margin * 2);
      lines.forEach((line) => {
        ensureSpace(14);
        doc.text(line, margin, y);
        y += 14;
      });
    }
    function bulletList(items, color) {
      doc.setFontSize(10);
      items.forEach((item) => {
        const lines = doc.splitTextToSize('•  ' + item, pageW - margin * 2 - 6);
        lines.forEach((line, i) => {
          ensureSpace(14);
          doc.setTextColor(color[0], color[1], color[2]);
          doc.text(line, margin + (i === 0 ? 0 : 12), y);
          y += 14;
        });
      });
      doc.setTextColor(0, 0, 0);
    }

    function sectionBanner(text) {
      ensureSpace(30);
      y += 6;
      doc.setFillColor(58, 45, 127);
      doc.rect(margin, y - 12, pageW - margin * 2, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(text, margin + 8, y + 2);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0, 0, 0);
      y += 22;
    }

    const ticker = state.rawInput || state.ticker || 'Stock';
    heading(ticker + ' — Analysis Report', 18);
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('Generated ' + new Date().toLocaleString('en-IN') + '  ·  Quant Verdict', margin, y);
    doc.setTextColor(0, 0, 0);
    y += 22;

    const d = state.sheet || {};
    const sn2 = d.snapshot || {};
    const lastRow = state.df && state.df.length ? state.df[state.df.length - 1] : null;

    // ===================== HOME =====================
    sectionBanner('HOME');

    if (d.ticker || d.about) {
      if (d.ticker) heading(d.ticker + ' — Overview', 12);
      if (d.about) {
        para(d.about);
        y += 6;
      }
    }

    const infoLines = [];
    if (sn2.marketCapCr != null) infoLines.push('Market Cap: Rs.' + fmt(sn2.marketCapCr, 0) + ' Cr.');
    if (sn2.currentPrice != null) infoLines.push('Price: Rs.' + fmt(sn2.currentPrice));
    if (sn2.stockPE != null) infoLines.push('P/E: ' + fmt(sn2.stockPE));
    if (sn2.bookValue != null) infoLines.push('Book Value: Rs.' + fmt(sn2.bookValue));
    if (sn2.roe != null) infoLines.push('ROE: ' + sn2.roe + '%');
    if (sn2.roce != null) infoLines.push('ROCE: ' + sn2.roce + '%');
    if (sn2.dividendYield != null) infoLines.push('Div Yield: ' + sn2.dividendYield + '%');
    if (infoLines.length) {
      heading('Company Info', 13);
      para(infoLines.join('    |    '));
      y += 8;
    }

    if (state.verdict) {
      heading('Verdict: ' + state.verdict.master, 13);
      para(state.verdict.summary);
      y += 6;
      if (state.verdict.bull.length) {
        heading('Positive Drivers', 11);
        bulletList(state.verdict.bull, [22, 140, 60]);
        y += 6;
      }
      if (state.verdict.bear.length) {
        heading('Risk Warnings', 11);
        bulletList(state.verdict.bear, [200, 40, 40]);
        y += 6;
      }
    }

    // ===================== CHART ANALYSIS =====================
    sectionBanner('CHART ANALYSIS');

    if (typeof Plotly !== 'undefined' && $('#price-chart')) {
      try {
        const imgData = await Plotly.toImage('price-chart', { format: 'png', width: 700, height: 350 });
        const w = pageW - margin * 2;
        const h = (w * 350) / 700;
        ensureSpace(h + 30);
        heading('Price Chart', 13);
        doc.addImage(imgData, 'PNG', margin, y, w, h);
        y += h + 16;
      } catch (e) {
        console.warn('Chart export skipped', e);
      }
    }

    if (lastRow) {
      const piv = Indicators.pivots(lastRow);
      heading('Intraday Pivot Levels', 12);
      para(
        'R2: Rs.' + fmt(piv.r2) + '   R1: Rs.' + fmt(piv.r1) + '   Pivot: Rs.' + fmt(piv.pivot) +
          '   S1: Rs.' + fmt(piv.s1) + '   S2: Rs.' + fmt(piv.s2) + '   ATR(14): Rs.' + fmt(piv.atr)
      );
      y += 8;
    }

    if (state.df) {
      const patterns = Indicators.detectCandlestickPatterns(state.df);
      const breakout = Indicators.detectBreakout(state.df, 20);
      if (patterns.length || breakout) {
        heading('Candlestick & Breakout Signals', 12);
        const lines = patterns.map((p) => p.name + ' (' + p.signal + '): ' + p.note);
        if (breakout) lines.push((breakout.type === 'breakout' ? 'Breakout: ' : 'Breakdown: ') + breakout.note);
        bulletList(lines, [40, 40, 40]);
        y += 6;
      }
    }

    // ===================== FUNDAMENTAL ANALYSIS =====================
    sectionBanner('FUNDAMENTAL ANALYSIS');

    if (d.pros && d.pros.length) {
      heading('Pros', 12);
      bulletList(d.pros, [22, 140, 60]);
      y += 6;
    }
    if (d.cons && d.cons.length) {
      heading('Cons', 12);
      bulletList(d.cons, [200, 40, 40]);
      y += 6;
    }

    const keyMetricLines = [];
    if (d.trailingEps != null) keyMetricLines.push('TTM EPS: Rs.' + fmt(d.trailingEps));
    if (d.bookValue != null) keyMetricLines.push('Book Value: Rs.' + fmt(d.bookValue));
    if (d.freeCashflowCr != null) keyMetricLines.push('FCF: Rs.' + fmt(d.freeCashflowCr, 0) + ' Cr.');
    if (d.salesTtmCr != null) keyMetricLines.push('Sales TTM: Rs.' + fmt(d.salesTtmCr, 0) + ' Cr.');
    if (d.patTtmCr != null) keyMetricLines.push('PAT TTM: Rs.' + fmt(d.patTtmCr, 0) + ' Cr.');
    if (keyMetricLines.length) {
      heading('Key Metrics', 12);
      para(keyMetricLines.join('    |    '));
      y += 8;
    }

    const g = d.salesGrowth || {};
    const pg = d.profitGrowth || {};
    const growthLines = [];
    if (g.ttm != null) growthLines.push('Sales growth (TTM): ' + g.ttm + '%');
    if (pg.ttm != null) growthLines.push('Profit growth (TTM): ' + pg.ttm + '%');
    if (g.y5 != null) growthLines.push('Sales growth (5Y): ' + g.y5 + '%');
    if (pg.y5 != null) growthLines.push('Profit growth (5Y): ' + pg.y5 + '%');
    if (growthLines.length) {
      heading('Growth', 12);
      para(growthLines.join('    |    '));
      y += 8;
    }

    const dupont = duPontAnalysis(d, sn2);
    if (dupont) {
      heading('DuPont ROE Decomposition', 12);
      para(
        'Net Margin: ' + dupont.netMargin.toFixed(2) + '%   Asset Turnover: ' + dupont.assetTurnover.toFixed(2) +
          '×   Equity Multiplier: ' + dupont.equityMultiplier.toFixed(2) + '×   Computed ROE: ' +
          dupont.computedRoe.toFixed(2) + '%'
      );
      y += 8;
    }

    const piotroski = piotroskiFScore(d);
    if (piotroski) {
      heading('Piotroski F-Score: ' + piotroski.score + ' / ' + piotroski.max, 12);
      y += 4;
    }

    const gf = grahamFormulaFairValue(d);
    const lv = lynchFairValue(d);
    const fvLines = [];
    if (gf) fvLines.push('Graham Formula: Rs.' + fmt(gf.value) + (gf.floored ? ' (5% growth floor used)' : ''));
    if (lv) fvLines.push('Peter Lynch: Rs.' + fmt(lv.value) + (lv.floored ? ' (5% growth floor used)' : ''));
    if (fvLines.length) {
      heading('Fair Value Estimates', 12);
      para(fvLines.join('    |    '));
      y += 8;
    }

    // ===================== QUALITY MATRIX =====================
    sectionBanner('QUALITY MATRIX');

    const qualityLines = [];
    if (d.roe && d.roe.last != null) qualityLines.push('ROE (last yr): ' + d.roe.last + '%');
    if (d.roce != null) qualityLines.push('ROCE: ' + d.roce + '%');
    if (d.opmTtm != null) qualityLines.push('OPM TTM: ' + d.opmTtm + '%');
    if (d.promoters != null) qualityLines.push('Promoter holding: ' + d.promoters + '%');
    if (d.fiis != null || d.diis != null) qualityLines.push('FII+DII: ' + ((d.fiis || 0) + (d.diis || 0)).toFixed(2) + '%');
    if (qualityLines.length) {
      heading('Accounting & Solvency', 12);
      para(qualityLines.join('    |    '));
      y += 8;
    }

    if (state.df) {
      const rm = Indicators.riskMetrics(state.df);
      const wk52 = Indicators.week52Range(state.df);
      const riskLines = [];
      if (rm) {
        riskLines.push('Annualized Return: ' + rm.annualReturn.toFixed(1) + '%');
        riskLines.push('Annualized Volatility: ' + rm.annualVol.toFixed(1) + '%');
        if (rm.sharpe != null) riskLines.push('Sharpe: ' + rm.sharpe.toFixed(2));
        riskLines.push('Max Drawdown: ' + rm.maxDrawdown.toFixed(1) + '%');
      }
      if (wk52) {
        riskLines.push('52W High: Rs.' + fmt(wk52.high));
        riskLines.push('52W Low: Rs.' + fmt(wk52.low));
      }
      if (riskLines.length) {
        heading('Risk & Return Analytics', 12);
        para(riskLines.join('    |    '));
        y += 8;
      }

      if (lastRow) {
        const proj = returnProjection(d, sn2, lastRow.close, rm);
        if (proj) {
          const projLines = [];
          if (proj.trend.oneYear != null) projLines.push('Trend 1Y: ' + proj.trend.oneYear.toFixed(1) + '%');
          if (proj.reversion.oneYear != null) projLines.push('Fair-value re-rating 1Y: ' + proj.reversion.oneYear.toFixed(1) + '%');
          if (projLines.length) {
            heading('Return Projection (illustrative, not a forecast)', 12);
            para(projLines.join('    |    '));
            y += 8;
          }
        }
      }
    }

    // Disclaimer
    ensureSpace(50);
    y += 6;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageW - margin, y);
    y += 16;
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    para(
      'This report is generated automatically from Screener.in and Yahoo Finance data using formula-based ' +
        'models (Graham, Peter Lynch, DuPont, Piotroski, technical indicators). It is not investment advice. ' +
        'Verify all figures independently before making any investment decision.',
      8
    );

    return doc;
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

  function setupTickerAutocomplete(input, box) {
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

  function setupSearch() {
    setupTickerAutocomplete($('#ticker-input'), $('#search-suggest'));
    setupTickerAutocomplete($('#peer-1'), $('#peer-1-suggest'));
    setupTickerAutocomplete($('#peer-2'), $('#peer-2-suggest'));
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
      '<div class="two-col">' +
      '<div><strong style="color:var(--green)">Pros</strong><ul class="bull-list">' +
      (d.pros || []).map((p) => '<li>' + p + '</li>').join('') +
      '</ul></div>' +
      '<div><strong style="color:var(--red)">Cons</strong><ul class="bear-list">' +
      (d.cons || []).map((c) => '<li>' + c + '</li>').join('') +
      '</ul></div></div>' +
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

  function grahamFormulaFairValue(d) {
    const eps = d.trailingEps;
    const rawGrowth = d.salesGrowth && d.salesGrowth.ttm != null ? d.salesGrowth.ttm : null;
    if (eps == null || eps <= 0 || rawGrowth == null) return null;
    const floored = rawGrowth < 0;
    const g = floored ? 5 : rawGrowth;
    return { value: eps * (8.5 + 2 * g), floored, rawGrowth };
  }

  function lynchFairValue(d) {
    const eps = d.trailingEps;
    const rawGrowth = d.salesGrowth && d.salesGrowth.ttm != null ? d.salesGrowth.ttm : null;
    if (eps == null || eps <= 0 || rawGrowth == null) return null;
    const floored = rawGrowth < 0;
    const g = floored ? 5 : rawGrowth;
    return { value: eps * g, floored, rawGrowth };
  }

  function fibProximity(df) {
    if (!df || df.length < 10) return {};
    const levels = Indicators.fibonacciLevels(df, 130);
    const last = df[df.length - 1];
    if (!levels || last.close == null) return {};
    const range = levels[0].price - levels[levels.length - 1].price;
    if (!range) return {};
    const tolerance = range * 0.03;
    let support = false;
    let resistance = false;
    levels.forEach((lvl) => {
      if (lvl.ratio === 0 || lvl.ratio === 1) return; // skip the raw swing high/low themselves
      if (Math.abs(last.close - lvl.price) <= tolerance) {
        if (last.close <= lvl.price) support = true;
        else resistance = true;
      }
    });
    return { fibSupport: support, fibResistance: resistance };
  }

  function returnProjection(d, sn, currentPrice, riskMetrics) {
    if (currentPrice == null || currentPrice <= 0) return null;
    const out = { trend: {}, reversion: {}, volRange: {} };
    let any = false;

    // Scenario 1: extrapolate Screener's own historical price CAGR forward.
    // Pure trend continuation — says nothing about whether that trend will
    // actually hold.
    const pc = d.priceCagr || {};
    if (pc.y1 != null) {
      out.trend.threeMonth = (Math.pow(1 + pc.y1 / 100, 0.25) - 1) * 100;
      out.trend.sixMonth = (Math.pow(1 + pc.y1 / 100, 0.5) - 1) * 100;
      out.trend.oneYear = pc.y1;
      any = true;
    }
    if (pc.y5 != null) {
      out.trend.fiveYear = (Math.pow(1 + pc.y5 / 100, 5) - 1) * 100;
      any = true;
    }

    // Scenario 2: what re-rating to the Graham Formula / Peter Lynch fair
    // value (averaged, using the same 5% growth floor rule) would imply, at
    // different horizons. 3M/6M assume only a fraction of the gap closes
    // (re-rating takes time); 1Y assumes it closes fully; 5Y assumes it
    // closes then compounds at the floored growth rate.
    const gf = grahamFormulaFairValue(d);
    const lv = lynchFairValue(d);
    const fairValues = [gf && gf.value, lv && lv.value].filter((v) => v != null && v > 0);
    if (fairValues.length) {
      const avgFair = fairValues.reduce((a, b) => a + b, 0) / fairValues.length;
      const gapPct = ((avgFair - currentPrice) / currentPrice) * 100;
      out.reversion.fairValue = avgFair;
      out.reversion.gapPct = gapPct;
      out.reversion.threeMonth = gapPct * 0.25;
      out.reversion.sixMonth = gapPct * 0.5;
      out.reversion.oneYear = gapPct;
      const growth = gf && gf.rawGrowth != null ? gf.rawGrowth : null;
      const flooredGrowth = growth != null && growth < 0 ? 5 : growth;
      const postReRateGrowth = flooredGrowth != null ? flooredGrowth : 8;
      out.reversion.fiveYear =
        ((avgFair * Math.pow(1 + postReRateGrowth / 100, 4) - currentPrice) / currentPrice) * 100;
      any = true;
    }

    // Scenario 3: volatility-implied range (±1 std dev) at 3M/6M — a
    // statistically grounded short-term range rather than a point guess,
    // derived purely from the stock's own historical price volatility.
    if (riskMetrics) {
      const r3 = Indicators.volatilityRange(riskMetrics, currentPrice, 63); // ~3 trading months
      const r6 = Indicators.volatilityRange(riskMetrics, currentPrice, 126); // ~6 trading months
      if (r3) out.volRange.threeMonth = r3;
      if (r6) out.volRange.sixMonth = r6;
      if (r3 || r6) any = true;
    }

    return any ? out : null;
  }

  function drawPriceChart() {
    if (typeof Charts === 'undefined') return;
    const target = state.fullscreenChart ? '#price-chart-fullscreen' : '#price-chart';
    if (state.intradayInterval && state.intradayDf) {
      Charts.priceChart(state.intradayDf, state.showBollinger, null, 0, target);
      return;
    }
    if (!state.df) return;
    const data = Indicators.aggregateOHLC(state.df, state.chartTimeframe);
    const fib = state.fibEnabled ? Indicators.fibonacciLevels(data, 130) : null;
    const ichimokuData = state.ichimokuEnabled ? Indicators.ichimoku(data) : null;
    let daysToShow = state.chartRange;
    if (daysToShow && state.chartTimeframe === 'W') daysToShow = Math.ceil(daysToShow / 5);
    else if (daysToShow && state.chartTimeframe === 'M') daysToShow = Math.ceil(daysToShow / 21);
    Charts.priceChart(data, state.showBollinger, fib, daysToShow, target, ichimokuData);
  }

  async function loadIntradayChart(interval) {
    const host = $('#price-chart');
    if (host) host.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:20px">Loading intraday data…</p>';
    try {
      const result = await DataService.fetchIntraday(state.ticker, interval);
      state.intradayInterval = interval;
      state.intradayDf = Indicators.calculateAll(result.history);
      drawPriceChart();
    } catch (e) {
      console.warn('Intraday fetch failed', e);
      if (host)
        host.innerHTML =
          '<p style="color:var(--text-muted);font-size:13px;padding:20px">Intraday data unavailable for this interval right now — try Day/Week/Month instead.</p>';
    }
  }

  function openChartFullscreen() {
    const overlay = $('#chart-fullscreen');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.classList.remove('hidden');
    state.fullscreenChart = true;

    // Best-effort fullscreen + landscape lock. Neither is universally
    // supported (iOS Safari in particular has no Orientation Lock API at
    // all, and some browsers only allow orientation lock while the fullscreen
    // API is also active) — every step here is wrapped so a missing API
    // just silently skips rather than breaking the overlay itself.
    const el = overlay;
    const requestFs =
      el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (requestFs) {
      try {
        requestFs.call(el).catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }

    drawPriceChart();
    // Plotly needs a resize nudge once the fullscreen layout has actually
    // settled — immediate draw can measure the pre-fullscreen container size.
    setTimeout(() => drawPriceChart(), 200);

    // The rotation animation itself can finish later than our fixed 200ms
    // redraw above (varies by device) — catch that with a live listener
    // instead of guessing a longer fixed delay.
    window.addEventListener('resize', fullscreenResizeHandler);
    window.addEventListener('orientationchange', fullscreenResizeHandler);
  }

  function fullscreenResizeHandler() {
    if (state.fullscreenChart) drawPriceChart();
  }

  function closeChartFullscreen() {
    const overlay = $('#chart-fullscreen');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.classList.add('hidden');
    state.fullscreenChart = false;
    window.removeEventListener('resize', fullscreenResizeHandler);
    window.removeEventListener('orientationchange', fullscreenResizeHandler);

    if (screen.orientation && screen.orientation.unlock) {
      try {
        screen.orientation.unlock();
      } catch (e) {
        /* ignore */
      }
    }
    const exitFs =
      document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (document.fullscreenElement && exitFs) {
      try {
        exitFs.call(document).catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }
    drawPriceChart();
  }

  function renderCandlestickPatterns(df) {
    const host = $('#candlestick-patterns');
    if (!host) return;
    const patterns = Indicators.detectCandlestickPatterns(df);
    const breakout = Indicators.detectBreakout(df, 20);
    const colorFor = { bullish: 'var(--green)', bearish: 'var(--red)', neutral: 'var(--text-muted)' };
    let html = '';
    if (breakout) {
      const signal = breakout.type === 'breakout' ? 'bullish' : 'bearish';
      html +=
        '<div style="margin-bottom:10px;padding-left:10px;border-left:3px solid ' + colorFor[signal] + '">' +
        '<div style="font-weight:600;color:' + colorFor[signal] + '">' +
        (breakout.type === 'breakout' ? '20-Day Breakout' : '20-Day Breakdown') +
        '</div><div style="font-size:12.5px;color:var(--text-muted)">' + breakout.note + '</div></div>';
    }
    if (patterns.length) {
      html += patterns
        .map(
          (p) =>
            '<div style="margin-bottom:10px;padding-left:10px;border-left:3px solid ' + colorFor[p.signal] + '">' +
            '<div style="font-weight:600;color:' + colorFor[p.signal] + '">' + p.name +
            ' <span style="font-size:11px;text-transform:uppercase;font-weight:600">(' + p.signal + ')</span></div>' +
            '<div style="font-size:12.5px;color:var(--text-muted)">' + p.note + '</div></div>'
        )
        .join('');
    }
    host.innerHTML = html || '<p style="font-size:13px;color:var(--text-muted)">No notable pattern or breakout on the latest candle(s).</p>';
  }

  function renderRiskMetrics(df, sheet) {
    const host = $('#risk-metrics-row');
    if (!host) return;
    const m = Indicators.riskMetrics(df);
    const wk52 = Indicators.week52Range(df);
    function card(label, val, cls) {
      return (
        '<div class="metric-card"><div class="label">' + label + '</div>' +
        '<div class="value" style="font-size:17px' + (cls ? ';' + cls : '') + '">' + val + '</div></div>'
      );
    }
    let html = '';
    if (m) {
      html +=
        card('Annualized Return', m.annualReturn.toFixed(1) + '%', 'color:' + (m.annualReturn >= 0 ? 'var(--green)' : 'var(--red)')) +
        card('Annualized Volatility', m.annualVol.toFixed(1) + '%') +
        card('Sharpe Ratio (Rf 7%)', m.sharpe != null ? m.sharpe.toFixed(2) : '—') +
        card('Max Drawdown', m.maxDrawdown.toFixed(1) + '%', 'color:var(--red)') +
        card('Best Day', '+' + m.bestDay.toFixed(1) + '%', 'color:var(--green)') +
        card('Worst Day', m.worstDay.toFixed(1) + '%', 'color:var(--red)');
    }
    if (wk52) {
      html +=
        card('52W High', formatINR(wk52.high)) +
        card('52W Low', formatINR(wk52.low)) +
        card('% From 52W High', wk52.pctFromHigh.toFixed(1) + '%', 'color:var(--red)') +
        card('% From 52W Low', '+' + wk52.pctFromLow.toFixed(1) + '%', 'color:var(--green)');
    }
    host.innerHTML = html || '<p style="font-size:12px;color:var(--text-muted)">Not enough price history for risk analytics.</p>';

    renderReturnProjection(df, sheet, m);
  }

  function renderReturnProjection(df, sheet, riskMetrics) {
    const host = $('#return-projection');
    if (!host) return;
    if (!df || !df.length || !sheet) {
      host.innerHTML = '';
      return;
    }
    const currentPrice = df[df.length - 1].close;
    const proj = returnProjection(sheet, sheet.snapshot || {}, currentPrice, riskMetrics);
    if (!proj) {
      host.innerHTML = '';
      return;
    }
    function pctCell(val) {
      if (val == null || isNaN(val)) return '<td>—</td>';
      const cls = val >= 0 ? 'color:var(--green)' : 'color:var(--red)';
      return '<td style="' + cls + '">' + (val >= 0 ? '+' : '') + val.toFixed(1) + '%</td>';
    }
    const horizons = [
      { label: '3 Months', trend: proj.trend.threeMonth, reversion: proj.reversion.threeMonth },
      { label: '6 Months', trend: proj.trend.sixMonth, reversion: proj.reversion.sixMonth },
      { label: '1 Year', trend: proj.trend.oneYear, reversion: proj.reversion.oneYear },
      { label: '5 Years (cumulative)', trend: proj.trend.fiveYear, reversion: proj.reversion.fiveYear }
    ].filter((h) => h.trend != null || h.reversion != null);
    if (!horizons.length && !proj.volRange.threeMonth && !proj.volRange.sixMonth) {
      host.innerHTML = '';
      return;
    }
    const rows = horizons
      .map((h) => '<tr><td>' + h.label + '</td>' + pctCell(h.trend) + pctCell(h.reversion) + '</tr>')
      .join('');
    function volRow(label, r) {
      if (!r) return '';
      return (
        '<tr><td>' + label + '</td><td colspan="2">' +
        formatINR(r.lower) + ' – ' + formatINR(r.upper) +
        ' <span style="color:var(--text-muted)">(±' + r.pctRange.toFixed(1) + '%)</span></td></tr>'
      );
    }
    const volRows = volRow('3 Months (±1σ range)', proj.volRange.threeMonth) + volRow('6 Months (±1σ range)', proj.volRange.sixMonth);
    host.innerHTML =
      '<div class="card" style="margin-top:14px;overflow-x:auto">' +
      '<h3>Illustrative Return Projection (3M / 6M / 1Y / 5Y)</h3>' +
      '<p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">' +
      'Three different models, not a forecast. "Trend continuation" extrapolates Screener\'s own historical price CAGR forward. ' +
      '"Fair value re-rating" shows what happens if price closes part (short term) or all (1Y+) of the gap to the Graham Formula / ' +
      'Peter Lynch average fair value. The ±1σ range below is a statistical range from the stock\'s own historical volatility, not ' +
      'a target — real returns depend on markets, not formulas.' +
      '</p>' +
      '<table class="data-table"><thead><tr><th>Horizon</th><th>Trend Continuation</th><th>Fair Value Re-rating</th></tr></thead>' +
      '<tbody>' + rows + volRows + '</tbody></table></div>';
  }

  // ---------- Market view ----------
  function technicalBias(row) {
    if (!row) return null;
    let bullPoints = 0;
    let bearPoints = 0;
    let total = 0;
    if (row.sma50 != null && row.sma200 != null) {
      total++;
      if (row.sma50 > row.sma200) bullPoints++;
      else bearPoints++;
    }
    if (row.rsi != null) {
      total++;
      if (row.rsi > 50) bullPoints++;
      else if (row.rsi < 50) bearPoints++;
    }
    if (row.macdHist != null) {
      total++;
      if (row.macdHist > 0) bullPoints++;
      else bearPoints++;
    }
    if (!total) return null;
    const bullRatio = bullPoints / total;
    let label;
    let cls;
    if (bullRatio >= 0.66) {
      label = 'Bullish';
      cls = 'var(--green)';
    } else if (bullRatio <= 0.33) {
      label = 'Bearish';
      cls = 'var(--red)';
    } else {
      label = 'Neutral';
      cls = 'var(--text-muted)';
    }
    return { label, cls, bullRatio };
  }

  function renderMultiTimeframeConfluence() {
    const host = $('#mtf-confluence');
    if (!host) return;
    if (!state.df || state.df.length < 30) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Not enough price history.</p>';
      return;
    }
    const weekly = Indicators.aggregateOHLC(state.df, 'W');
    const monthly = Indicators.aggregateOHLC(state.df, 'M');
    const timeframes = [
      { label: 'Day', bias: technicalBias(state.df[state.df.length - 1]) },
      { label: 'Week', bias: technicalBias(weekly[weekly.length - 1]) },
      { label: 'Month', bias: technicalBias(monthly[monthly.length - 1]) }
    ].filter((t) => t.bias);

    if (!timeframes.length) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Not enough history to compute confluence.</p>';
      return;
    }
    const bullCount = timeframes.filter((t) => t.bias.label === 'Bullish').length;
    const bearCount = timeframes.filter((t) => t.bias.label === 'Bearish').length;
    let summary;
    if (bullCount === timeframes.length) {
      summary = { text: `All ${timeframes.length} timeframes bullish — strong confluence.`, color: 'var(--green)' };
    } else if (bearCount === timeframes.length) {
      summary = { text: `All ${timeframes.length} timeframes bearish — strong confluence.`, color: 'var(--red)' };
    } else {
      summary = { text: 'Mixed signals across timeframes — no strong confluence.', color: 'var(--text-muted)' };
    }
    const cards = timeframes
      .map(
        (t) =>
          '<div class="metric-card"><div class="label">' + t.label + '</div><div class="value" style="font-size:16px;color:' +
          t.bias.cls + '">' + t.bias.label + '</div></div>'
      )
      .join('');
    host.innerHTML =
      '<div class="metrics-row" style="margin-bottom:10px">' + cards + '</div>' +
      '<p style="font-size:13px;font-weight:600;color:' + summary.color + '">' + summary.text + '</p>';
  }

  function renderVolumeProfile(df) {
    const host = $('#volume-profile');
    if (!host) return;
    const vp = Indicators.volumeProfile(df, 16);
    if (!vp) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Not enough data.</p>';
      return;
    }
    const maxVol = vp.maxVol || 1;
    const rows = vp.levels
      .slice()
      .reverse() // highest price at top, matching how price charts read
      .map((lvl) => {
        const isPoc = lvl.priceLow <= vp.pocPrice && vp.pocPrice < lvl.priceHigh;
        const pct = (lvl.volume / maxVol) * 100;
        const label = '₹' + fmt((lvl.priceLow + lvl.priceHigh) / 2, 0);
        return (
          '<div class="vp-row' + (isPoc ? ' vp-poc' : '') + '">' +
          '<div class="vp-label">' + label + '</div>' +
          '<div class="vp-bar-track"><div class="vp-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
          '</div>'
        );
      })
      .join('');
    host.innerHTML =
      rows +
      '<p style="font-size:11px;color:var(--text-muted);margin-top:8px">Point of Control (heaviest historical volume): <strong style="color:var(--orange)">₹' +
      fmt(vp.pocPrice) + '</strong></p>';
  }

  const VERDICT_HISTORY_KEY = 'quantVerdict.history.v1';

  function loadVerdictHistoryStore() {
    try {
      return JSON.parse(localStorage.getItem(VERDICT_HISTORY_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveVerdictHistoryEntry(ticker, entry) {
    try {
      const store = loadVerdictHistoryStore();
      const key = ticker.toUpperCase();
      const list = store[key] || [];
      const today = new Date().toISOString().slice(0, 10);
      // Replace today's entry if one already exists, so re-analysing the
      // same ticker repeatedly in a day doesn't spam duplicate rows.
      const idx = list.findIndex((e) => e.date === today);
      if (idx >= 0) list[idx] = entry;
      else list.push(entry);
      store[key] = list.slice(-50); // cap history length per ticker
      localStorage.setItem(VERDICT_HISTORY_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn('Could not save verdict history', e);
    }
  }

  function renderVerdictHistory(ticker) {
    const host = $('#verdict-history');
    if (!host || !ticker) return;
    const store = loadVerdictHistoryStore();
    const list = (store[ticker.toUpperCase()] || []).slice().reverse();
    if (!list.length) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">No saved history yet for this ticker — check back after future visits.</p>';
      return;
    }
    const currentPrice = state.df && state.df.length ? state.df[state.df.length - 1].close : null;
    const rows = list
      .map((e) => {
        let changeCell = '—';
        if (currentPrice != null && e.price) {
          const pct = ((currentPrice - e.price) / e.price) * 100;
          changeCell =
            '<span style="color:' + (pct >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
            (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>';
        }
        return (
          '<tr><td>' + e.date + '</td><td>' + e.master + '</td><td>' +
          (e.price != null ? '₹' + fmt(e.price) : '—') + '</td><td>' + changeCell + '</td></tr>'
        );
      })
      .join('');
    host.innerHTML =
      '<table class="data-table"><thead><tr><th>Date</th><th>Verdict</th><th>Price Then</th><th>Change Since</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function exportCsv() {
    if (!state.df || !state.df.length) {
      alert('Analyse a ticker first.');
      return;
    }
    const lines = [];
    lines.push('Quant Verdict Export — ' + (state.rawInput || state.ticker || '') + ' — ' + new Date().toLocaleString('en-IN'));
    lines.push('');
    lines.push('=== Price History ===');
    lines.push('Date,Open,High,Low,Close,Volume,SMA50,SMA200,RSI,MACD Hist');
    state.df.forEach((r) => {
      lines.push(
        [
          r.date, r.open, r.high, r.low, r.close, r.volume,
          r.sma50 != null ? r.sma50.toFixed(2) : '',
          r.sma200 != null ? r.sma200.toFixed(2) : '',
          r.rsi != null ? r.rsi.toFixed(2) : '',
          r.macdHist != null ? r.macdHist.toFixed(2) : ''
        ].join(',')
      );
    });

    if (state.sheet) {
      const d = state.sheet;
      const sn = d.snapshot || {};
      const g = d.salesGrowth || {};
      const pg = d.profitGrowth || {};
      lines.push('');
      lines.push('=== Company Info ===');
      lines.push('Metric,Value');
      if (sn.marketCapCr != null) lines.push('Market Cap (Cr),' + sn.marketCapCr);
      if (sn.currentPrice != null) lines.push('Current Price,' + sn.currentPrice);
      if (sn.stockPE != null) lines.push('P/E,' + sn.stockPE);
      if (sn.bookValue != null) lines.push('Book Value,' + sn.bookValue);
      if (sn.roe != null) lines.push('ROE %,' + sn.roe);
      if (sn.roce != null) lines.push('ROCE %,' + sn.roce);
      if (sn.dividendYield != null) lines.push('Dividend Yield %,' + sn.dividendYield);
      lines.push('');
      lines.push('=== Growth ===');
      lines.push('Metric,Value');
      if (g.ttm != null) lines.push('Sales Growth TTM %,' + g.ttm);
      if (pg.ttm != null) lines.push('Profit Growth TTM %,' + pg.ttm);
      if (g.y5 != null) lines.push('Sales Growth 5Y %,' + g.y5);
      if (pg.y5 != null) lines.push('Profit Growth 5Y %,' + pg.y5);
    }

    if (state.verdict) {
      lines.push('');
      lines.push('=== Verdict ===');
      lines.push('Master,' + state.verdict.master);
      lines.push('Bull Ratio,' + (state.verdict.bullRatio * 100).toFixed(1) + '%');
    }

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.rawInput || 'export') + '-quant-verdict.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function renderMarketView() {
    renderCompanyInfoTop(state.sheet);
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
      renderVerdictHistory(state.rawInput);
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
    renderCandlestickPatterns(state.df);
    renderRiskMetrics(state.df, state.sheet);
    renderMultiTimeframeConfluence();
    renderVolumeProfile(state.df);
    renderVerdictHistory(state.rawInput);
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

    function applyGrowthFloor(g) {
      return g < 0 ? { used: 5, floored: true } : { used: g, floored: false };
    }

    function updateGrahamFormula() {
      if (!gfEpsEl || !gfGrowthEl) return;
      const eps = parseFloat(gfEpsEl.value) || 0;
      const gRaw = parseFloat(gfGrowthEl.value) || 0;
      const { used: g, floored } = applyGrowthFloor(gRaw);
      const v = eps * (8.5 + 2 * g);
      if (eps > 0 && v > 0) {
        $('#gf-result').innerHTML =
          'Graham Formula Fair Value: <strong>' + formatINR(v) + '</strong>' +
          (floored
            ? '<br><span style="font-size:11px;color:var(--text-muted)">Entered growth (' +
              gRaw.toFixed(1) + '%) is negative — used a 5% floor for this calculation instead.</span>'
            : '');
      } else if (eps > 0) {
        $('#gf-result').textContent = 'Enter a growth rate';
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
      const gRaw = parseFloat(plGrowthEl.value) || 0;
      const { used: g, floored } = applyGrowthFloor(gRaw);
      if (eps > 0) {
        $('#pl-result').innerHTML =
          'Peter Lynch Fair Value: <strong>' + formatINR(eps * g) + '</strong>' +
          (floored
            ? '<br><span style="font-size:11px;color:var(--text-muted)">Entered growth (' +
              gRaw.toFixed(1) + '%) is negative — used a 5% floor for this calculation instead.</span>'
            : '');
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
    renderSeasonality();
    const btn = $('#run-backtest');
    if (btn) btn.onclick = runBacktest;
  }

  function renderSeasonality() {
    const host = $('#seasonality-body');
    if (!host) return;
    const df = state.df;
    if (!df || df.length < 60) {
      host.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Not enough price history.</td></tr>';
      return;
    }
    // Group daily returns by calendar month, tracking which distinct
    // (year, month) periods contributed so "years of data" is accurate
    // rather than just a day count.
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const buckets = Array.from({ length: 12 }, () => ({ returns: [], periods: new Set() }));
    df.forEach((row) => {
      if (row.dailyReturn == null || !row.date) return;
      const m = parseInt(row.date.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) return;
      buckets[m].returns.push(row.dailyReturn);
      buckets[m].periods.add(row.date.slice(0, 7)); // YYYY-MM
    });
    const rows = buckets
      .map((b, i) => {
        if (b.periods.size < 2) return null; // need at least 2 occurrences to mean anything
        const monthlyReturns = groupIntoPeriodReturns(df, i);
        if (!monthlyReturns.length) return null;
        const avg = monthlyReturns.reduce((a, b2) => a + b2, 0) / monthlyReturns.length;
        const wins = monthlyReturns.filter((r) => r > 0).length;
        return {
          name: monthNames[i],
          avg: avg * 100,
          winRate: (wins / monthlyReturns.length) * 100,
          years: monthlyReturns.length
        };
      })
      .filter(Boolean);
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Not enough distinct months of history yet.</td></tr>';
      return;
    }
    host.innerHTML = rows
      .map(
        (r) =>
          '<tr><td>' + r.name + '</td><td style="color:' + (r.avg >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
          (r.avg >= 0 ? '+' : '') + r.avg.toFixed(2) + '%</td><td>' + r.winRate.toFixed(0) + '%</td><td>' + r.years + '</td></tr>'
      )
      .join('');
  }

  // Compounds daily returns within each distinct (year, month) period into
  // one return per period, for the given calendar month index (0-11).
  function groupIntoPeriodReturns(df, monthIndex) {
    const periods = {};
    df.forEach((row) => {
      if (row.dailyReturn == null || !row.date) return;
      const m = parseInt(row.date.slice(5, 7), 10) - 1;
      if (m !== monthIndex) return;
      const key = row.date.slice(0, 7);
      if (!periods[key]) periods[key] = 1;
      periods[key] *= 1 + row.dailyReturn;
    });
    return Object.values(periods).map((factor) => factor - 1);
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
  function tvSymbolFor(ticker) {
    if (!ticker) return null;
    // state.ticker is like "RELIANCE.NS" or an index like "^NSEI" — strip
    // the Yahoo suffix and prefix with NSE: for TradingView's symbol format.
    const base = ticker.replace(/\.NS$/i, '').replace(/^\^/, '');
    return 'NSE:' + base;
  }

  function updateTvLink() {
    const link = $('#tv-link');
    if (!link) return;
    const symbol = tvSymbolFor(state.ticker);
    link.href = symbol
      ? 'https://in.tradingview.com/chart/?symbol=' + encodeURIComponent(symbol)
      : 'https://in.tradingview.com/';
  }

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
    state.intradayInterval = null;
    state.intradayDf = null;
    const intervalSel = $('#chart-interval');
    if (intervalSel) intervalSel.value = 'D';
    state.sheet = null;
    const peer1El = $('#peer-1');
    const peer2El = $('#peer-2');
    const peerResultEl = $('#peer-comparison-result');
    if (peer1El) peer1El.value = '';
    if (peer2El) peer2El.value = '';
    if (peerResultEl) peerResultEl.innerHTML = '';
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

      if (sheetRes && sheetRes.ok && sheetRes.data) {
        applySheet(sheetRes.data);
      }

      if (chartRes.history && chartRes.history.length >= 30) {
        state.df = Indicators.calculateAll(chartRes.history);

        // Merge in the advanced signals so the verdict engine can actually
        // use them — previously the verdict ran before applySheet(), so it
        // never saw fundamentals at all, only Yahoo's bare price info.
        const verdictInfo = Object.assign({}, state.info);
        if (state.sheet) {
          const sn = state.sheet.snapshot || {};
          const gf = grahamFormulaFairValue(state.sheet);
          const lv = lynchFairValue(state.sheet);
          verdictInfo.grahamFormulaValue = gf ? gf.value : null;
          verdictInfo.lynchValue = lv ? lv.value : null;
          verdictInfo.growthFloored = (gf && gf.floored) || (lv && lv.floored) || false;
          verdictInfo.piotroski = piotroskiFScore(state.sheet);
          verdictInfo.dupont = duPontAnalysis(state.sheet, sn);
        }
        verdictInfo.riskMetrics = Indicators.riskMetrics(state.df);
        Object.assign(verdictInfo, fibProximity(state.df));
        verdictInfo.candlePatterns = Indicators.detectCandlestickPatterns(state.df);
        verdictInfo.breakout = Indicators.detectBreakout(state.df, 20);
        const ichi = Indicators.ichimoku(state.df);
        if (ichi) {
          const i = state.df.length - 1;
          verdictInfo.ichimoku = {
            price: state.df[i].close,
            senkouA: ichi.senkouA[i - 26] != null ? ichi.senkouA[i - 26] : null,
            senkouB: ichi.senkouB[i - 26] != null ? ichi.senkouB[i - 26] : null,
            tenkan: ichi.tenkan[i],
            kijun: ichi.kijun[i]
          };
        }

        state.verdict = VerdictEngine.analyse(state.df, verdictInfo);
        if (state.verdict && state.rawInput) {
          saveVerdictHistoryEntry(state.rawInput, {
            date: new Date().toISOString().slice(0, 10),
            master: state.verdict.master,
            bullRatio: state.verdict.bullRatio,
            price: state.df[state.df.length - 1].close
          });
        }
      } else {
        state.df = null;
        state.verdict = null;
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
      const reportActions = $('#report-actions');
      if (reportActions) reportActions.style.display = 'flex';
      $('#asset-title').textContent = 'Strategic Asset Intelligence Center (' + state.rawInput + ')';

      if (state.view === 'market') {
        setWorkspace('market');
      } else {
        setWorkspace('quant');
      }

      updateTvLink();

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

  function showMobileZone(zoneId) {
    $$('.mobile-zone').forEach((z) => z.classList.remove('mobile-active'));
    const zone = $('#' + zoneId);
    if (zone) zone.classList.add('mobile-active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setWorkspace(view, navKey, mobileZone) {
    state.view = view;
    const radio = document.querySelector('input[name="workspace"][value="' + view + '"]');
    if (radio) radio.checked = true;
    $$('.mnav-btn[data-nav]').forEach((b) => b.classList.remove('active'));
    const key = navKey || (view === 'market' ? 'home' : 'quality');
    const navBtn = document.querySelector('.mnav-btn[data-nav="' + key + '"]');
    if (navBtn) navBtn.classList.add('active');

    const backHomeBtn = $('#mobile-back-home');
    if (backHomeBtn) backHomeBtn.style.display = view === 'quant' ? '' : 'none';

    if (!state.df) return;
    if (view === 'market') {
      show($('#view-market'));
      hide($('#view-quant'));
      renderMarketView();
      showMobileZone(mobileZone || 'zone-verdict');
    } else {
      hide($('#view-market'));
      show($('#view-quant'));
      renderQuantView();
    }
  }

  function setTab(tabName) {
    $$('.tab-btn').forEach((x) => x.classList.remove('active'));
    $$('.tab-content').forEach((c) => c.classList.remove('active'));
    const btn = document.querySelector('.tab-btn[data-tab="' + tabName + '"]');
    if (btn) btn.classList.add('active');
    const tab = $('#tab-' + tabName);
    if (tab) tab.classList.add('active');
  }

  function openMoreSheet() {
    const sheet = $('#more-sheet');
    if (sheet) sheet.classList.add('open');
  }
  function closeMoreSheet() {
    const sheet = $('#more-sheet');
    if (sheet) sheet.classList.remove('open');
  }

  function init() {
    $$('input[name="workspace"]').forEach((radio) => {
      radio.addEventListener('change', (e) => setWorkspace(e.target.value));
    });
    $$('.mnav-btn[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nav = btn.dataset.nav;
        if (nav === 'home') {
          setWorkspace('market', 'home', 'zone-verdict');
        } else if (nav === 'quality') {
          setWorkspace('quant');
          setTab('quality');
        } else if (nav === 'chart') {
          setWorkspace('market', 'chart', 'zone-chart');
        } else if (nav === 'fundamentals') {
          setWorkspace('market', 'fundamentals', 'zone-fundamentals');
        } else if (nav === 'more') {
          openMoreSheet();
        }
      });
    });
    const backHomeBtn = $('#mobile-back-home');
    if (backHomeBtn) backHomeBtn.addEventListener('click', () => setWorkspace('market', 'home', 'zone-verdict'));
    const expandBtn = $('#chart-expand-btn');
    if (expandBtn) expandBtn.addEventListener('click', openChartFullscreen);
    const fsCloseBtn = $('#chart-fullscreen-close');
    if (fsCloseBtn) fsCloseBtn.addEventListener('click', closeChartFullscreen);
    const pdfBtn = $('#pdf-report-btn');
    if (pdfBtn)
      pdfBtn.addEventListener('click', async () => {
        const orig = pdfBtn.textContent;
        pdfBtn.disabled = true;
        pdfBtn.textContent = 'Generating…';
        try {
          const doc = await generatePdfReport();
          if (doc) doc.save((state.rawInput || 'report') + '-quant-verdict.pdf');
        } catch (e) {
          console.error(e);
          alert('Could not generate the PDF report.');
        } finally {
          pdfBtn.disabled = false;
          pdfBtn.textContent = orig;
        }
      });
    const shareBtn = $('#share-report-btn');
    if (shareBtn)
      shareBtn.addEventListener('click', async () => {
        const orig = shareBtn.textContent;
        shareBtn.disabled = true;
        shareBtn.textContent = 'Preparing…';
        try {
          const doc = await generatePdfReport();
          if (!doc) return;
          const filename = (state.rawInput || 'report') + '-quant-verdict.pdf';
          const blob = doc.output('blob');
          const file = new File([blob], filename, { type: 'application/pdf' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: (state.rawInput || 'Stock') + ' Analysis Report',
              text: 'Quant Verdict analysis for ' + (state.rawInput || '')
            });
          } else if (navigator.share) {
            // Some browsers support share() for text/url but not files — still
            // give them the actual PDF via download since it can't be attached.
            doc.save(filename);
            await navigator.share({
              title: (state.rawInput || 'Stock') + ' Analysis Report',
              text: 'Quant Verdict analysis for ' + (state.rawInput || ''),
              url: location.href
            });
          } else {
            doc.save(filename);
            alert("Sharing isn't supported in this browser — downloaded the PDF instead.");
          }
        } catch (e) {
          if (e && e.name !== 'AbortError') {
            console.error(e);
            alert('Could not share the report.');
          }
        } finally {
          shareBtn.disabled = false;
          shareBtn.textContent = orig;
        }
      });
    $$('.more-item[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setWorkspace('quant');
        setTab(btn.dataset.tab);
        closeMoreSheet();
      });
    });
    const moreBackdrop = $('#more-sheet-backdrop');
    if (moreBackdrop) moreBackdrop.addEventListener('click', closeMoreSheet);
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
    const ichi = $('#show-ichimoku');
    if (ichi)
      ichi.addEventListener('change', () => {
        state.ichimokuEnabled = ichi.checked;
        if (state.view === 'market') drawPriceChart();
      });
    const peerBtn = $('#peer-compare-btn');
    if (peerBtn) peerBtn.addEventListener('click', runPeerComparison);
    const csvBtn = $('#csv-export-btn');
    if (csvBtn) csvBtn.addEventListener('click', exportCsv);
    const intervalSel = $('#chart-interval');
    if (intervalSel) {
      intervalSel.addEventListener('change', (e) => {
        const val = e.target.value;
        const note = $('#chart-mode-note');
        if (val === 'D' || val === 'W' || val === 'M') {
          state.chartTimeframe = val;
          state.intradayInterval = null;
          state.intradayDf = null;
          if (note) note.textContent = 'This chart drives the automated verdict below — indicators here feed the bull/bear scoring.';
          if (state.view === 'market') drawPriceChart();
        } else {
          if (note) note.textContent = 'Intraday view — for your own reading only, it does not feed the verdict below (which is based on daily history).';
          if (state.view === 'market') loadIntradayChart(val);
        }
      });
    }
    $$('input[name="chart-range"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        state.chartRange = parseInt(e.target.value, 10) || 0;
        if (state.view === 'market') drawPriceChart();
      });
    });
    // Shorter default range on mobile — a full year of daily candles
    // squeezed into a phone-width chart reads as a solid smear rather than
    // individual candles. Desktop keeps the 1Y default (HTML checkbox
    // default), unchanged.
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      state.chartRange = 126;
      const sixM = document.querySelector('input[name="chart-range"][value="126"]');
      if (sixM) sixM.checked = true;
    }
    const input = $('#ticker-input');
    if (input) input.addEventListener('keydown', (e) => e.key === 'Enter' && loadTicker());
    const btn = $('#analyse-btn');
    if (btn) btn.addEventListener('click', loadTicker);
    $$('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => setTab(b.dataset.tab));
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

    // Android/Chrome PWA install prompt. This event doesn't fire on iOS
    // Safari, in an already-installed context, or in browsers without
    // install support — the button just stays hidden in those cases.
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      show($('#install-row'));
    });
    const installBtn = $('#install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        hide($('#install-row'));
      });
    }
    window.addEventListener('appinstalled', () => hide($('#install-row')));

    const homeNavBtn = document.querySelector('.mnav-btn[data-nav="home"]');
    if (homeNavBtn) homeNavBtn.classList.add('active');

    loadEquityList().then(setupSearch);
    // Don't auto-load heavy analyse on first paint — wait for user (faster)
    // loadTicker();
    hide($('#loading'));
    show($('#main-content'));
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
