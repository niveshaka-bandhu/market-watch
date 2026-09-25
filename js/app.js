// ========== PASTE YOUR APPS SCRIPT WEB APP URL HERE ==========
const SHEETS_API = 'https://script.google.com/macros/s/AKfycbxgR0EC7xaqe9H0Wx9gG0pQcpl2Elb-Skoxz_Pz7wPA6N3zTckWQFyb_u6TFfFo7oux/exec';
// ============================================================
// Must exceed the Apps Script side's MAX_WAIT_MS (170s) — otherwise the
// browser gives up on a slow IMPORTHTML scrape before the server does, and
// the (eventually correct) response arrives too late to be used.
const SHEETS_ANALYSE_TIMEOUT_MS = 185000;
// Your GitHub Pages URL for this app — shown at the end of the shared text
// report so whoever receives it can open the app themselves.
const APP_URL = 'https://YOUR-USERNAME.github.io/YOUR-REPO/';

const App = (() => {
  let state = {
    ticker: '',
    rawInput: '',
    df: null,
    info: {},
    verdict: null,
    showBollinger: true,
    // Line by default — candlesticks packed into a phone-width chart read as
    // a solid smear rather than individual candles. The "Candlestick" button
    // switches this AND opens fullscreen together, since candlesticks only
    // really work with the extra room fullscreen provides.
    chartType: 'line',
    priceMode: 'price', // 'price' | 'pe' | 'pb' — same chart container, different data
    fibEnabled: false,
    regressionChannelEnabled: false,
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
  let benchmarkDf = null;
  let benchmarkFetchPromise = null;

  function getBenchmarkDf() {
    if (benchmarkDf) return Promise.resolve(benchmarkDf);
    if (!benchmarkFetchPromise) {
      benchmarkFetchPromise = DataService.fetchBenchmarkHistory()
        .then((result) => {
          benchmarkDf = Indicators.calculateAll(result.history);
          return benchmarkDf;
        })
        .catch((e) => {
          console.warn('Benchmark (Nifty 50) fetch failed', e);
          benchmarkFetchPromise = null;
          return null;
        });
    }
    return benchmarkFetchPromise;
  }

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

  function updateStickyQuote(d) {
    const group = $('#sticky-quote-group');
    const el = $('#sticky-quote');
    if (!group || !el) return;
    if (!d) {
      group.style.display = 'none';
      return;
    }
    const sn = d.snapshot || {};
    const parts = [];
    if (sn.currentPrice != null) parts.push('LTP: ₹' + fmt(sn.currentPrice));
    if (sn.stockPE != null) parts.push('P/E: ' + fmt(sn.stockPE));
    if (!parts.length) {
      group.style.display = 'none';
      return;
    }
    el.innerHTML = parts.map((p) => '<span>' + p + '</span>').join('');
    group.style.display = 'flex';
  }

  function renderCompanyInfoTop(d) {
    const host = $('#company-info-top');
    if (!host) return;
    updateStickyQuote(d);
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
    if (d.about) {
      host.innerHTML +=
        '<div style="margin-top:12px">' +
        '<p id="company-about-text" class="about-truncated" style="font-size:13px;color:var(--text-muted);line-height:1.5;margin:8px 0 4px">' +
        d.about + '</p>' +
        '<button type="button" id="company-about-toggle" style="background:none;border:none;color:var(--accent);font-weight:600;font-size:12px;cursor:pointer;padding:0">Show more</button>' +
        '</div>';
      const toggleBtn = $('#company-about-toggle');
      const textEl = $('#company-about-text');
      if (toggleBtn && textEl) {
        toggleBtn.addEventListener('click', () => {
          const expanded = textEl.classList.toggle('about-expanded');
          textEl.classList.toggle('about-truncated', !expanded);
          toggleBtn.textContent = expanded ? 'Show less' : 'Show more';
        });
      }
    }
  }

  async function fetchPeerData(rawTicker) {
    const res = await sheetsJsonp({ action: 'analyse', ticker: rawTicker }, SHEETS_ANALYSE_TIMEOUT_MS);
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

    // Compact grid for the raw scraped tables (Quarterly Results, P&L,
    // Balance Sheet, Cash Flow, Ratios, Shareholding Pattern) — capped to
    // the most recent maxCols periods so columns stay wide enough to read
    // at page width instead of dumping a decade of illegible columns.
    function pdfTable(title, table, maxCols) {
      if (!table || !table.rows || !table.rows.length) return;
      const headers = table.headers || [];
      let cols = [];
      for (let c = 0; c < headers.length; c++) if (headers[c]) cols.push(c);
      if (maxCols && cols.length > maxCols) cols = cols.slice(-maxCols);
      if (!cols.length) return;

      heading(title, 11);
      const labelW = 118;
      const colW = (pageW - margin * 2 - labelW) / cols.length;
      const rowH = 12;

      ensureSpace(rowH * 2);
      doc.setFontSize(7.5);
      doc.setFont(undefined, 'bold');
      cols.forEach((c, i) => {
        doc.text(String(headers[c] || ''), margin + labelW + i * colW, y, { maxWidth: colW - 3 });
      });
      doc.setFont(undefined, 'normal');
      y += rowH;
      doc.setDrawColor(210, 210, 210);
      doc.line(margin, y - 9, pageW - margin, y - 9);

      table.rows.forEach((row) => {
        ensureSpace(rowH);
        doc.setFontSize(7.5);
        doc.text(String(row.label || ''), margin, y, { maxWidth: labelW - 4 });
        cols.forEach((c, i) => {
          const val = row.cells && row.cells[c] != null ? String(row.cells[c]) : '';
          doc.text(val, margin + labelW + i * colW, y, { maxWidth: colW - 3 });
        });
        y += rowH;
      });
      y += 8;
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
    const displayName = (state.sheet && state.sheet.companyName) || ticker;
    heading(displayName + (displayName !== ticker ? ' (' + ticker + ')' : '') + ' — Analysis Report', 18);
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('Generated ' + new Date().toLocaleString('en-IN') + ' by Quant Verdict', margin, y);
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

    if (state.bottomLine) {
      heading('BOTTOM LINE: ' + state.bottomLine.action, 14);
      para(state.bottomLine.reason);
      y += 6;
    }

    if (state.verdict) {
      heading('Master Verdict: ' + state.verdict.master, 13);
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

    const extraVerdictLines = [];
    if (state.longTermVerdict) extraVerdictLines.push('Long-Term Investment: ' + state.longTermVerdict.verdict);
    if (state.riskVerdict) extraVerdictLines.push('Risk Level: ' + state.riskVerdict.level);
    if (state.valuationVerdict) extraVerdictLines.push('Valuation: ' + state.valuationVerdict.tag);
    if (state.nbScore) extraVerdictLines.push('NB Score: ' + state.nbScore.score + '/' + state.nbScore.max + ' (' + state.nbScore.tag + ')');
    if (extraVerdictLines.length) {
      heading('Additional Verdicts', 12);
      para(extraVerdictLines.join('    |    '));
      y += 8;
    }

    // ===================== CHART ANALYSIS =====================
    sectionBanner('CHART ANALYSIS');

    if (typeof Plotly !== 'undefined' && $('#price-chart')) {
      try {
        const imgData = await Plotly.toImage('price-chart', { format: 'png', width: 700, height: 350 });
        const w = Math.min(300, pageW - margin * 2); // small — most of the page is for data, not the chart
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
      const techLines = [];
      if (lastRow.close != null) techLines.push('Close: Rs.' + fmt(lastRow.close));
      if (lastRow.sma50 != null) techLines.push('SMA50: Rs.' + fmt(lastRow.sma50));
      if (lastRow.sma200 != null) techLines.push('SMA200: Rs.' + fmt(lastRow.sma200));
      if (lastRow.rsi != null) techLines.push('RSI(14): ' + lastRow.rsi.toFixed(1));
      if (lastRow.macd != null) techLines.push('MACD: ' + lastRow.macd.toFixed(2));
      if (lastRow.macdHist != null) techLines.push('MACD Hist: ' + lastRow.macdHist.toFixed(2));
      if (lastRow.volume != null) techLines.push('Volume: ' + Math.round(lastRow.volume).toLocaleString('en-IN'));
      if (techLines.length) {
        heading('Technical Snapshot', 12);
        para(techLines.join('    |    '));
        y += 8;
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
    if (sn2.currentPrice != null) keyMetricLines.push('Price: Rs.' + fmt(sn2.currentPrice));
    if (d.trailingEps != null) keyMetricLines.push('TTM EPS: Rs.' + fmt(d.trailingEps));
    if (d.bookValue != null) keyMetricLines.push('Book Value: Rs.' + fmt(d.bookValue));
    if (sn2.currentPrice != null && d.bookValue > 0) keyMetricLines.push('P/B: ' + fmt(sn2.currentPrice / d.bookValue, 2));
    if (sn2.dividendYield != null) keyMetricLines.push('Div Yield: ' + sn2.dividendYield + '%');
    if (d.freeCashflowCr != null) keyMetricLines.push('FCF: Rs.' + fmt(d.freeCashflowCr, 0) + ' Cr.');
    if (d.cfoCr != null) keyMetricLines.push('CFO: Rs.' + fmt(d.cfoCr, 0) + ' Cr.');
    if (d.salesTtmCr != null) keyMetricLines.push('Sales TTM: Rs.' + fmt(d.salesTtmCr, 0) + ' Cr.');
    if (d.patTtmCr != null) keyMetricLines.push('PAT TTM: Rs.' + fmt(d.patTtmCr, 0) + ' Cr.');
    if (d.equityCapitalCr != null) keyMetricLines.push('Equity Capital: Rs.' + fmt(d.equityCapitalCr, 0) + ' Cr.');
    if (d.reservesCr != null) keyMetricLines.push('Reserves: Rs.' + fmt(d.reservesCr, 0) + ' Cr.');
    if (d.borrowingsCr != null) keyMetricLines.push('Borrowings: Rs.' + fmt(d.borrowingsCr, 0) + ' Cr.');
    if (d.totalAssetsCr != null) keyMetricLines.push('Total Assets: Rs.' + fmt(d.totalAssetsCr, 0) + ' Cr.');
    if (state.df) {
      const wk52 = Indicators.week52Range(state.df);
      if (wk52) keyMetricLines.push('52W Range: Rs.' + fmt(wk52.low) + ' - Rs.' + fmt(wk52.high));
    }
    if (keyMetricLines.length) {
      heading('Key Metrics', 12);
      para(keyMetricLines.join('    |    '));
      y += 8;
    }

    const g = d.salesGrowth || {};
    const pg = d.profitGrowth || {};
    const pc = d.priceCagr || {};
    const roeG = d.roe || {};
    const growthLines = [];
    if (g.ttm != null) growthLines.push('Sales (TTM): ' + g.ttm + '%');
    if (g.y3 != null) growthLines.push('Sales (3Y): ' + g.y3 + '%');
    if (g.y5 != null) growthLines.push('Sales (5Y): ' + g.y5 + '%');
    if (g.y10 != null) growthLines.push('Sales (10Y): ' + g.y10 + '%');
    if (pg.ttm != null) growthLines.push('Profit (TTM): ' + pg.ttm + '%');
    if (pg.y3 != null) growthLines.push('Profit (3Y): ' + pg.y3 + '%');
    if (pg.y5 != null) growthLines.push('Profit (5Y): ' + pg.y5 + '%');
    if (pg.y10 != null) growthLines.push('Profit (10Y): ' + pg.y10 + '%');
    if (pc.y3 != null) growthLines.push('Price CAGR (3Y): ' + pc.y3 + '%');
    if (pc.y5 != null) growthLines.push('Price CAGR (5Y): ' + pc.y5 + '%');
    if (roeG.last != null) growthLines.push('ROE (Last Yr): ' + roeG.last + '%');
    if (growthLines.length) {
      heading('Growth (Sales / Profit / Price / ROE)', 12);
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
      const evaluated = piotroski.checks.filter((c) => c.pass !== null);
      bulletList(
        evaluated.map((c) => (c.pass ? '✓ ' : '✗ ') + c.label),
        [60, 60, 60]
      );
      y += 6;
    }

    const graham = d.trailingEps > 0 && d.bookValue > 0 ? Math.sqrt(22.5 * d.trailingEps * d.bookValue) : null;
    const gf = grahamFormulaFairValue(d);
    const lv = lynchFairValue(d);
    const acqM = acquirersMultiple(d, sn2);
    const magicY = magicFormulaYield(d, sn2);
    const price = sn2.currentPrice;
    function gapPct(fv) {
      return fv && price ? (((fv - price) / price) * 100).toFixed(1) + '%' : null;
    }
    const fvLines = [];
    if (graham != null) fvLines.push('Graham Number: Rs.' + fmt(graham) + (gapPct(graham) ? ' (' + gapPct(graham) + ' vs price)' : ''));
    if (gf) fvLines.push('Graham Formula: Rs.' + fmt(gf.value) + (gapPct(gf.value) ? ' (' + gapPct(gf.value) + ' vs price)' : '') + (gf.floored ? ' [floored]' : ''));
    if (lv) fvLines.push('Peter Lynch: Rs.' + fmt(lv.value) + (gapPct(lv.value) ? ' (' + gapPct(lv.value) + ' vs price)' : '') + (lv.floored ? ' [floored]' : ''));
    if (fvLines.length) {
      heading('Fair Value Estimates (gap = upside/downside to current price)', 12);
      para(fvLines.join('\n'));
      y += 8;
    }
    const deepValueLines = [];
    if (acqM) deepValueLines.push("Acquirer's Multiple: " + acqM.multiple.toFixed(2) + 'x' + (acqM.cheap ? ' (deep-value range, <6x)' : ''));
    if (magicY != null) deepValueLines.push('Magic Formula Earnings Yield: ' + magicY.toFixed(2) + '%');
    if (sn2.stockPE != null && d.bookValue > 0 && price) deepValueLines.push('P/E: ' + fmt(sn2.stockPE) + '   P/B: ' + fmt(price / d.bookValue, 2));
    if (deepValueLines.length) {
      para(deepValueLines.join('    |    '));
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

    const pdfQualityTrends = [
      trendVerdict('Promoter Holding', trendRow((d.tables || {}).shareholding, 'promoter'), { goodDirection: 'up' }),
      trendVerdict('FII Holding', trendRow((d.tables || {}).shareholding, 'fii'), { goodDirection: 'up' }),
      trendVerdict('DII Holding', trendRow((d.tables || {}).shareholding, 'dii'), { goodDirection: 'up' }),
      trendVerdict('Return on Equity', trendRow((d.tables || {}).ratios, 'return on equity') || trendRow((d.tables || {}).ratios, 'roe'), { goodDirection: 'up' }),
      trendVerdict('ROCE', trendRow((d.tables || {}).ratios, 'roce'), { goodDirection: 'up' }),
      trendVerdict('Borrowings (Debt)', trendRow((d.tables || {}).balanceSheet, 'borrowings'), { goodDirection: 'down', unit: ' Cr' })
    ].filter(Boolean);
    if (pdfQualityTrends.length) {
      heading('Quality & Moat Trends', 12);
      const trendLines = pdfQualityTrends.map(
        (r) => r.label + ': ' + fmt(r.latest, 2) + r.unit + ' — ' + r.tag +
          ' (' + (r.delta > 0 ? '+' : '') + fmt(r.delta, 2) + r.unit + ' since ' + r.since + ')'
      );
      para(trendLines.join('\n'));
      y += 8;
    }

    const pdfDupont = duPontAnalysis(d, sn2);
    const altman = altmanZScore(d, sn2);
    const acq = acquirersMultiple(d, sn2);
    const magicYield = magicFormulaYield(d, sn2);
    const rw = roicVsWacc(d);
    const r40 = ruleOf40(d, pdfDupont);
    const modelLines = [];
    if (altman) modelLines.push('Altman Z-Score: ' + altman.z.toFixed(2) + ' (' + altman.zone + ')');
    if (acq) modelLines.push("Acquirer's Multiple: " + acq.multiple.toFixed(2) + 'x' + (acq.cheap ? ' (deep-value range)' : ''));
    if (magicYield != null) modelLines.push('Magic Formula Yield: ' + magicYield.toFixed(2) + '%');
    if (rw) modelLines.push('ROIC vs WACC: ' + rw.roic.toFixed(1) + '% vs ' + rw.wacc.toFixed(1) + '% (' + (rw.creatingValue ? 'creating value' : 'destroying value') + ')');
    if (r40) modelLines.push('Rule of 40: ' + r40.score.toFixed(1) + '%' + (r40.healthy ? ' (healthy)' : ''));
    if (modelLines.length) {
      heading('Advanced Financial Models', 12);
      para(modelLines.join('\n'));
      para('Altman Z-Score approximates working capital and is designed for non-financial companies; ROIC/WACC assumes Beta = 1.', 8);
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

    // ===================== FINANCIAL STATEMENTS =====================
    doc.addPage();
    y = 50;
    sectionBanner('FINANCIAL STATEMENTS (most recent periods)');
    const dt = d.tables || {};
    pdfTable('Quarterly Results', dt.quarterly, 6);
    pdfTable('Profit & Loss', dt.profitLoss, 6);
    pdfTable('Balance Sheet', dt.balanceSheet, 5);
    pdfTable('Cash Flow', dt.cashFlow, 5);
    pdfTable('Ratios', dt.ratios, 5);
    pdfTable('Shareholding Pattern', dt.shareholding, 8);

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
        'models (Graham, Peter Lynch, DuPont, Piotroski, Altman Z-Score, ROIC/WACC, technical indicators). ' +
        'Altman Z-Score and ROIC/WACC use approximated inputs and assumptions (see Advanced Financial Models ' +
        'note above) and are not meaningful for banks/NBFCs/financial companies. This is not investment advice. ' +
        'Verify all figures independently, ideally against the source Screener.in page, before making any ' +
        'investment decision.',
      8
    );

    return doc;
  }

  // WhatsApp-friendly text report — WhatsApp renders *text* as bold and
  // _text_ as italic natively, so this uses that instead of any real
  // markup. Kept deliberately shorter than the PDF (top 3 bull/bear points,
  // not the full lists) since a wall of text defeats the point of choosing
  // text over a PDF in the first place.
  function generateTextReport() {
    const ticker = state.rawInput || state.ticker || 'Stock';
    const d = state.sheet || {};
    const sn2 = d.snapshot || {};
    const displayName = d.companyName || ticker;
    const lines = [];

    lines.push('*' + displayName + (displayName !== ticker ? ' (' + ticker + ')' : '') + ' — Analysis Report*');
    lines.push('_Generated ' + new Date().toLocaleDateString('en-IN') + '_');
    lines.push('');

    if (state.bottomLine) {
      lines.push('🎯 *Bottom Line:* ' + state.bottomLine.action);
      lines.push(state.bottomLine.reason);
      lines.push('');
    }

    const verdictLine = [];
    if (state.verdict) verdictLine.push('*Verdict:* ' + state.verdict.master + ' (' + (state.verdict.bullRatio * 100).toFixed(0) + '% bullish)');
    if (state.longTermVerdict) verdictLine.push('*Long-Term:* ' + state.longTermVerdict.verdict);
    if (state.riskVerdict) verdictLine.push('*Risk:* ' + state.riskVerdict.level);
    if (state.valuationVerdict) verdictLine.push('*Valuation:* ' + state.valuationVerdict.tag);
    if (state.nbScore) verdictLine.push('*NB Score:* ' + state.nbScore.score + '/' + state.nbScore.max + ' (' + state.nbScore.tag + ')');
    if (verdictLine.length) {
      lines.push(verdictLine.join('\n'));
      lines.push('');
    }

    const infoBits = [];
    if (sn2.marketCapCr != null) infoBits.push('MCap ₹' + fmt(sn2.marketCapCr, 0) + 'Cr');
    if (sn2.currentPrice != null) infoBits.push('Price ₹' + fmt(sn2.currentPrice));
    if (sn2.stockPE != null) infoBits.push('P/E ' + fmt(sn2.stockPE));
    if (sn2.roe != null) infoBits.push('ROE ' + sn2.roe + '%');
    if (sn2.roce != null) infoBits.push('ROCE ' + sn2.roce + '%');
    if (infoBits.length) {
      lines.push('💰 *Company Info*');
      lines.push(infoBits.join(' | '));
      lines.push('');
    }

    if (state.verdict && state.verdict.bull.length) {
      lines.push('✅ *Positive Drivers*');
      state.verdict.bull.slice(0, 3).forEach((b) => lines.push('• ' + b));
      lines.push('');
    }
    if (state.verdict && state.verdict.bear.length) {
      lines.push('⚠️ *Risk Warnings*');
      state.verdict.bear.slice(0, 3).forEach((b) => lines.push('• ' + b));
      lines.push('');
    }

    const trends = [
      trendVerdict('Promoter Holding', trendRow((d.tables || {}).shareholding, 'promoter'), { goodDirection: 'up' }),
      trendVerdict('ROE', trendRow((d.tables || {}).ratios, 'return on equity') || trendRow((d.tables || {}).ratios, 'roe'), { goodDirection: 'up' }),
      trendVerdict('ROCE', trendRow((d.tables || {}).ratios, 'roce'), { goodDirection: 'up' }),
      trendVerdict('Debt', trendRow((d.tables || {}).balanceSheet, 'borrowings'), { goodDirection: 'down', unit: ' Cr' })
    ].filter(Boolean);
    if (trends.length) {
      lines.push('📊 *Quality Trends*');
      trends.forEach((r) => lines.push(r.label + ': ' + fmt(r.latest, 2) + r.unit + ' (' + r.tag + ')'));
      lines.push('');
    }

    lines.push('_Not investment advice. Verify independently before deciding._');
    lines.push('');
    lines.push('📱 Generated using *Indian Quant Verdict* — analyse any NSE/BSE stock free: ' + APP_URL);
    return lines.join('\n');
  }

  // ---------- Sheets JSONP ----------
  function sheetsJsonp(params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const q = Object.keys(params)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');
      const s = document.createElement('script');
      const t = setTimeout(() => {
        cleanup();
        reject(new Error('Sheets timeout'));
      }, timeoutMs || 60000);
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

    // Rows where an increase from the previous period is a good sign —
    // colored light green on up, light pink on down. Deliberately a short,
    // high-confidence list rather than trying to classify every row: things
    // like "Total Assets" or "Other Liabilities" growing isn't unambiguously
    // good or bad for every company, so those are left uncolored rather
    // than risk a misleading signal.
    const GOOD_UP_ROWS = [
      'sales', 'net profit', 'operating profit', 'eps', 'return on equity', 'roce',
      'promoter', 'fii', 'dii', 'free cash flow', 'cash from operating activity'
    ];
    // Rows where a DECREASE from the previous period is the good sign.
    const GOOD_DOWN_ROWS = [
      'borrowings', 'debtor days', 'inventory days', 'days payable',
      'working capital days', 'cash conversion cycle'
    ];
    function rowColorDirection(label) {
      const low = (label || '').toLowerCase();
      if (GOOD_UP_ROWS.some((p) => low.indexOf(p) >= 0)) return 'up';
      if (GOOD_DOWN_ROWS.some((p) => low.indexOf(p) >= 0)) return 'down';
      return null;
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
          const direction = rowColorDirection(row.label);
          let prevVal = null;
          for (let c = Math.max(startC, 2); c < headers.length; c++) {
            if (!headers[c]) continue;
            const raw = cells[c] != null && cells[c] !== '' ? cells[c] : '—';
            let style = '';
            if (direction) {
              const val = parseNum(cells[c]);
              if (val != null && prevVal != null && val !== prevVal) {
                const up = val > prevVal;
                const good = direction === 'up' ? up : !up;
                style = good ? ' style="background:rgba(34,197,94,0.16)"' : ' style="background:rgba(239,68,68,0.14)"';
              }
              if (val != null) prevVal = val;
            }
            tds += '<td' + style + '>' + raw + '</td>';
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
        scoreBarHtml('Piotroski F-Score', pt.score, pt.max, pt.checks) +
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
      qualityMoatSection(d) +
      nbScoreSection() +
      advancedModelsSection(d) +
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

  const MONTH_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  // Screener period headers look like "Mar 2024" (quarterly) or "Mar 2020"
  // (annual, fiscal year-end) — this maps either to the last day of that
  // month, which is treated as "the day this period's numbers became known."
  function parsePeriodLabel(label) {
    if (!label) return null;
    const m = String(label).match(/([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (!m) return null;
    const month = MONTH_MAP[m[1]];
    const year = parseInt(m[2], 10);
    if (month == null || isNaN(year)) return null;
    return new Date(Date.UTC(year, month + 1, 0));
  }

  // Historical P/E: rolling trailing-4-quarter EPS from the Quarterly
  // Results table (already scraped, no new IMPORTHTML needed), stepped
  // forward onto the daily price series — P/E only updates when a new
  // quarter's EPS becomes available, exactly like the real ratio does.
  function buildPeSeries(df, quarterlyTable) {
    if (!df || !df.length || !quarterlyTable) return null;
    const row = tableRow(quarterlyTable, 'eps');
    if (!row) return null;
    const headers = quarterlyTable.headers || [];
    const points = [];
    headers.forEach((h, i) => {
      const d = parsePeriodLabel(h);
      const v = parseNum(row.cells[i]);
      if (d && v != null) points.push({ date: d, eps: v });
    });
    points.sort((a, b) => a.date - b.date);
    if (points.length < 4) return null;

    const ttmPoints = [];
    for (let i = 3; i < points.length; i++) {
      const ttm = points[i - 3].eps + points[i - 2].eps + points[i - 1].eps + points[i].eps;
      if (ttm > 0) ttmPoints.push({ date: points[i].date, ttmEps: ttm });
    }
    if (!ttmPoints.length) return null;

    const dates = [];
    const values = [];
    let ptr = -1;
    df.forEach((r) => {
      const rowDate = new Date(r.date + 'T00:00:00Z');
      while (ptr + 1 < ttmPoints.length && ttmPoints[ptr + 1].date <= rowDate) ptr++;
      const applicable = ptr >= 0 ? ttmPoints[ptr] : null;
      dates.push(r.date);
      values.push(applicable ? r.close / applicable.ttmEps : null);
    });
    return { dates, values };
  }

  // Historical P/B: book value per share from the annual Balance Sheet
  // table (Equity Capital + Reserves, both already scraped), divided by
  // current shares outstanding — assumes share count hasn't materially
  // changed historically (a split/bonus/rights issue would skew older
  // points), stepped onto the daily price series once per fiscal year.
  function buildPbSeries(df, balanceSheetTable, sharesOutstandingCr) {
    if (!df || !df.length || !balanceSheetTable || !sharesOutstandingCr) return null;
    const eqRow = tableRow(balanceSheetTable, 'equity capital');
    const resRow = tableRow(balanceSheetTable, 'reserves');
    if (!eqRow || !resRow) return null;
    const headers = balanceSheetTable.headers || [];
    const points = [];
    headers.forEach((h, i) => {
      const d = parsePeriodLabel(h);
      const eq = parseNum(eqRow.cells[i]);
      const res = parseNum(resRow.cells[i]);
      if (d && eq != null && res != null) {
        const bvps = (eq + res) / sharesOutstandingCr;
        if (bvps > 0) points.push({ date: d, bvps });
      }
    });
    points.sort((a, b) => a.date - b.date);
    if (!points.length) return null;

    const dates = [];
    const values = [];
    let ptr = -1;
    df.forEach((r) => {
      const rowDate = new Date(r.date + 'T00:00:00Z');
      while (ptr + 1 < points.length && points[ptr + 1].date <= rowDate) ptr++;
      const applicable = ptr >= 0 ? points[ptr] : null;
      dates.push(r.date);
      values.push(applicable ? r.close / applicable.bvps : null);
    });
    return { dates, values };
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

  // Full period-aligned trend for a labeled row — every already-scraped
  // table (Shareholding Pattern, Ratios, Balance Sheet, etc.) carries several
  // years/quarters of history, not just the latest value, so this reuses
  // that instead of needing any new IMPORTHTML/IMPORTXML formula.
  function trendRow(table, labelPart) {
    const row = tableRow(table, labelPart);
    if (!row || !table || !table.headers) return null;
    const periods = [];
    const values = [];
    table.headers.forEach((h, i) => {
      if (!h) return;
      const v = parseNum(row.cells[i]);
      if (v == null) return;
      periods.push(h);
      values.push(v);
    });
    if (values.length < 2) return null;
    return { periods, values };
  }

  // Turns a trend into a labeled, colored verdict: is it rising, falling,
  // or stable, and is that direction good or bad for this particular metric
  // (rising debt is bad, rising promoter holding is good, etc.)?
  function trendVerdict(label, tr, opts) {
    if (!tr) return null;
    const goodDirection = (opts && opts.goodDirection) || 'up';
    const unit = (opts && opts.unit) || '%';
    const first = tr.values[0];
    const last = tr.values[tr.values.length - 1];
    const delta = last - first;
    const threshold = Math.max(Math.abs(first) * 0.02, 0.3); // ignore noise
    let tag = 'Stable';
    let good = null;
    if (delta > threshold) {
      tag = 'Rising';
      good = goodDirection === 'up';
    } else if (delta < -threshold) {
      tag = 'Falling';
      good = goodDirection === 'down';
    }
    const color = good == null ? 'var(--text-muted)' : good ? 'var(--green)' : 'var(--red)';
    const arrow = tag === 'Rising' ? '▲' : tag === 'Falling' ? '▼' : '→';
    return {
      label, unit, tag, color, arrow, delta,
      latest: last,
      latestPeriod: tr.periods[tr.periods.length - 1],
      since: tr.periods[0],
      values: tr.values
    };
  }

  // Tiny inline SVG sparkline — avoids pulling in a full Plotly chart
  // container just to show a shape for 4-8 data points.
  function sparklineSvg(values, color) {
    if (!values || values.length < 2) return '';
    const w = 100, h = 28, pad = 3;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min || 1;
    const step = (w - pad * 2) / (values.length - 1);
    const pts = values
      .map((v, i) => {
        const x = pad + i * step;
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
      })
      .join(' ');
    return (
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h +
      '" style="display:block"><polyline points="' + pts +
      '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
  }

  // Trendlyne "Check Before You Buy"-style zone bar: a 0-to-max track with
  // red/yellow/green zones and a triangle marker at the actual score,
  // plus pass/fail counts. Shared by Piotroski and NB Score so both
  // multi-checkpoint scores get the same at-a-glance treatment.
  function scoreBarHtml(title, score, max, checks) {
    const passCount = checks.filter((c) => c.pass === true).length;
    const failCount = checks.filter((c) => c.pass === false).length;
    const pct = max > 0 ? Math.max(0, Math.min(100, (score / max) * 100)) : 0;
    const z1 = Math.round(max * 0.4);
    const z2 = Math.round(max * 0.65);
    const gradient =
      'linear-gradient(to right, #ef4444 0%, #ef4444 40%, #eab308 40%, #eab308 65%, #22c55e 65%, #22c55e 100%)';
    return (
      '<div class="score-bar-widget">' +
      '<div class="score-bar-header"><span style="font-weight:700">' + title + '</span>' +
      '<span class="score-bar-counts"><span class="pos">' + passCount + ' Positive</span> · <span class="neg">' +
      failCount + ' Negative</span></span></div>' +
      '<div class="score-bar-track" style="background:' + gradient + '">' +
      '<div class="score-bar-marker" style="left:' + pct.toFixed(1) + '%"></div>' +
      '</div>' +
      '<div class="score-bar-scale"><span>0</span><span>' + z1 + '</span><span>' + z2 + '</span><span>' + max + '</span></div>' +
      '</div>'
    );
  }

  // "Gauge by NB" — semicircular speedometer for the NB Score specifically,
  // same visual family as sentiment-gauge widgets (needle + colored zones).
  function nbGaugeSvg(score, max) {
    const cx = 110, cy = 100, r = 90;
    const pct = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
    const zones = [
      { from: 0, to: 0.4, color: '#ef4444' },
      { from: 0.4, to: 0.6, color: '#f59e0b' },
      { from: 0.6, to: 0.8, color: '#84cc16' },
      { from: 0.8, to: 1, color: '#16a34a' }
    ];
    function pointAt(frac, radius) {
      const a = Math.PI * (1 - frac);
      return [cx + radius * Math.cos(a), cy - radius * Math.sin(a)];
    }
    const arcPaths = zones
      .map((z) => {
        const [x1, y1] = pointAt(z.from, r);
        const [x2, y2] = pointAt(z.to, r);
        const largeArc = z.to - z.from > 0.5 ? 1 : 0;
        return (
          '<path d="M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' A ' + r + ' ' + r + ' 0 ' + largeArc +
          ' 0 ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="' + z.color +
          '" stroke-width="16" fill="none" stroke-linecap="butt"/>'
        );
      })
      .join('');
    const needleAngle = Math.PI * (1 - pct);
    const needleLen = r - 16;
    const tipX = cx + needleLen * Math.cos(needleAngle);
    const tipY = cy - needleLen * Math.sin(needleAngle);
    const [weakX, weakY] = pointAt(0.02, r + 16);
    const [excX, excY] = pointAt(0.98, r + 16);

    return (
      '<svg viewBox="0 0 220 132" width="100%" height="150" style="display:block;margin:0 auto">' +
      arcPaths +
      '<text x="' + weakX.toFixed(1) + '" y="' + weakY.toFixed(1) + '" font-size="9" font-weight="700" fill="#9ca3af" text-anchor="start">WEAK</text>' +
      '<text x="' + excX.toFixed(1) + '" y="' + excY.toFixed(1) + '" font-size="9" font-weight="700" fill="#16a34a" text-anchor="end">EXCELLENT</text>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + tipX.toFixed(1) + '" y2="' + tipY.toFixed(1) +
      '" stroke="#1b1f3b" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="#1b1f3b"/>' +
      '<text x="' + cx + '" y="' + (cy + 28) + '" text-anchor="middle" font-size="24" font-weight="800" font-family="IBM Plex Mono, monospace" fill="#1b1f3b">' +
      score + '/' + max + '</text>' +
      '</svg>'
    );
  }

  function miniTag(cssClass, text) {
    const color =
      cssClass === 'strong-buy' ? 'var(--green)' :
      cssClass === 'sell' ? 'var(--red)' :
      cssClass === 'mild-buy' ? 'var(--yellow)' : 'var(--text-muted)';
    return '<span style="color:' + color + ';font-weight:700">' + text + '</span>';
  }

  function advancedModelsSection(d) {
    const sn = d.snapshot || {};
    const dupont = duPontAnalysis(d, sn);
    const altman = altmanZScore(d, sn);
    const acq = acquirersMultiple(d, sn);
    const magicYield = magicFormulaYield(d, sn);
    const rw = roicVsWacc(d);
    const r40 = ruleOf40(d, dupont);

    const rows = [];
    if (altman) {
      rows.push(
        '<tr><td>Altman Z-Score</td><td>' + fmt(altman.z, 2) + '</td><td>' +
        miniTag(altman.cssClass, altman.zone) + '</td></tr>'
      );
    }
    if (acq) {
      rows.push(
        "<tr><td>Acquirer's Multiple (EV/EBIT)</td><td>" + fmt(acq.multiple, 2) + 'x</td><td>' +
        miniTag(acq.cheap ? 'strong-buy' : 'neutral', acq.cheap ? 'Deep-value range' : 'Above 6.0x') + '</td></tr>'
      );
    }
    if (magicYield != null) {
      rows.push(
        '<tr><td>Magic Formula Earnings Yield</td><td>' + fmt(magicYield, 2) + '%</td><td>' +
        miniTag(magicYield > 12 ? 'strong-buy' : magicYield < 5 ? 'sell' : 'neutral',
          magicYield > 12 ? 'Attractive' : magicYield < 5 ? 'Low' : 'Moderate') + '</td></tr>'
      );
    }
    if (rw) {
      rows.push(
        '<tr><td>ROIC vs WACC</td><td>' + fmt(rw.roic, 1) + '% vs ' + fmt(rw.wacc, 1) + '%</td><td>' +
        miniTag(rw.creatingValue ? 'strong-buy' : 'sell', rw.creatingValue ? 'Creating value' : 'Destroying value') + '</td></tr>'
      );
    }
    if (r40) {
      rows.push(
        '<tr><td>Rule of 40 (growth + margin)</td><td>' + fmt(r40.score, 1) + '%</td><td>' +
        miniTag(r40.healthy ? 'strong-buy' : 'neutral', r40.healthy ? 'Healthy' : 'Below 40') + '</td></tr>'
      );
    }
    if (!rows.length) return '';

    return (
      '<div class="card" style="margin-top:14px;overflow-x:auto">' +
      '<h3>Advanced Financial Models</h3>' +
      '<p style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">' +
      "Altman Z-Score approximates working capital from Screener's general asset/liability categories (not a precise current-assets breakdown) and is designed for non-financial companies — treat it as indicative, especially for banks/NBFCs. " +
      'ROIC vs WACC assumes Beta = 1 (not fetched in this flow) and a 25% default tax rate where Screener doesn\'t report one directly.' +
      '</p>' +
      '<table class="data-table"><thead><tr><th>Model</th><th>Value</th><th>Read</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table></div>'
    );
  }

  // Quality & Moat Trends: pulls promoter/FII/DII holding, ROE/ROCE, and
  // debt trends out of tables the app already scrapes, and surfaces the
  // direction (rising/falling/stable) with a plain-language takeaway —
  // the multi-period data was always there, just buried in raw tables at
  // the bottom of the page where nobody reads it as a trend.
  // NB Score detail card — reads from the already-computed state.nbScore
  // (built in recomputeVerdict from both chart and fundamental data) rather
  // than recomputing, so this can never disagree with the badge above it.
  function nbScoreSection() {
    const nb = state.nbScore;
    if (!nb) return '';
    const rows = nb.checks
      .filter((c) => c.pass !== null)
      .map(
        (c) =>
          '<li style="color:' + (c.pass ? 'var(--green)' : 'var(--red)') + '">' +
          (c.pass ? '✓ ' : '✗ ') + c.label + '</li>'
      )
      .join('');
    return (
      '<div class="card" style="margin-top:14px">' +
      '<h3>NB Score: ' + nb.score + ' / ' + nb.max + ' — ' + nb.tag + '</h3>' +
      '<div class="nb-gauge-widget">' + nbGaugeSvg(nb.score, nb.max) +
      '<div class="nb-gauge-label">GAUGE BY NB</div></div>' +
      scoreBarHtml('NB Score', nb.score, nb.max, nb.checks) +
      '<p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">' +
      'A Piotroski-style checklist for long-term investors: 3 chart-based checks + 7 fundamental checks. ' +
      'See the Learn tab for what each check means.</p>' +
      '<ul class="bull-list" style="list-style:none;padding:0">' + rows + '</ul></div>'
    );
  }

  function qualityMoatSection(d) {
    const t = d.tables || {};
    const candidates = [
      trendVerdict('Promoter Holding', trendRow(t.shareholding, 'promoter'), { goodDirection: 'up' }),
      trendVerdict('FII Holding', trendRow(t.shareholding, 'fii'), { goodDirection: 'up' }),
      trendVerdict('DII Holding', trendRow(t.shareholding, 'dii'), { goodDirection: 'up' }),
      trendVerdict('Return on Equity', trendRow(t.ratios, 'return on equity') || trendRow(t.ratios, 'roe'), { goodDirection: 'up' }),
      trendVerdict('ROCE', trendRow(t.ratios, 'roce'), { goodDirection: 'up' }),
      trendVerdict('Borrowings (Debt)', trendRow(t.balanceSheet, 'borrowings'), { goodDirection: 'down', unit: ' Cr' })
    ];
    const rows = candidates.filter(Boolean);
    if (!rows.length) return '';

    const rowsHtml = rows
      .map(
        (r) =>
          '<tr><td>' + r.label + '</td>' +
          '<td>' + sparklineSvg(r.values, r.color === 'var(--text-muted)' ? 'var(--text-muted)' : r.color) + '</td>' +
          '<td>' + fmt(r.latest, 2) + r.unit +
          '<div style="font-size:10px;color:var(--text-muted)">' + r.latestPeriod + '</div></td>' +
          '<td style="color:' + r.color + '">' + r.arrow + ' ' + r.tag +
          '<div style="font-size:10px">' + (r.delta > 0 ? '+' : '') + fmt(r.delta, 2) + r.unit +
          ' since ' + r.since + '</div></td></tr>'
      )
      .join('');

    const takeaways = rows
      .filter((r) => r.tag !== 'Stable' && r.color !== 'var(--text-muted)')
      .map(
        (r) =>
          '<li>' + r.label + ' has been ' + r.tag.toLowerCase() + ' (' +
          (r.delta > 0 ? '+' : '') + fmt(r.delta, 2) + r.unit + ' since ' + r.since + ') — ' +
          (r.color === 'var(--green)' ? 'a positive sign' : 'worth watching') +
          ' for a long-term holder.</li>'
      )
      .join('');

    return (
      '<div class="card" style="margin-top:14px;overflow-x:auto">' +
      '<h3>Quality &amp; Moat Trends</h3>' +
      '<p style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">' +
      'Direction over the full period Screener reports, not just the latest snapshot.' +
      '</p>' +
      '<table class="data-table"><thead><tr><th>Metric</th><th>Trend</th><th>Latest</th><th>Direction</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table>' +
      (takeaways ? '<ul class="bull-list" style="margin-top:10px">' + takeaways + '</ul>' : '') +
      '</div>'
    );
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

  // ---------------- Advanced Financial Models ----------------
  // Shared building blocks. EBIT = Profit Before Tax + Interest (standard
  // identity: PBT already has interest and depreciation subtracted, adding
  // interest back removes only that, not depreciation, which is correct —
  // EBIT still nets out D&A, only Interest and Tax are excluded).
  function ebitCr(d) {
    const pl = (d.tables || {}).profitLoss;
    const pbt = latestValues(pl, 'profit before tax', 1)[0];
    const interest = latestValues(pl, 'interest', 1)[0];
    if (pbt == null) return null;
    return pbt + (interest || 0);
  }

  // Enterprise Value = Market Cap + Debt. Screener's standard balance sheet
  // doesn't break out Cash & Equivalents separately from other assets, so
  // this can't net cash off the way a precise EV normally would — treat it
  // as an upper-bound EV, not an exact one.
  function enterpriseValueCr(d, sn) {
    if (sn.marketCapCr == null) return null;
    return sn.marketCapCr + (d.borrowingsCr || 0);
  }

  // Altman Z-Score (bankruptcy risk). IMPORTANT CAVEAT: designed for
  // non-financial/industrial companies — meaningless for banks, NBFCs, and
  // insurers, whose capital structure works entirely differently (this app
  // has no sector/industry field yet to auto-detect and skip those).
  // X1 (working capital / total assets) is approximated from Screener's
  // "Other Assets" / "Other Liabilities" catch-all rows, since the standard
  // balance sheet view doesn't separately report current assets/
  // liabilities — treat the whole score as indicative, not precision
  // research.
  function altmanZScore(d, sn) {
    const bs = (d.tables || {}).balanceSheet;
    const ta = d.totalAssetsCr;
    if (ta == null || ta <= 0 || sn.marketCapCr == null) return null;

    const otherAssets = latestValues(bs, 'other assets', 1)[0];
    const otherLiabilities = latestValues(bs, 'other liabilities', 1)[0];
    const borrowings = d.borrowingsCr || 0;
    const totalLiabExEquity = borrowings + (otherLiabilities || 0);
    if (totalLiabExEquity <= 0) return null;

    const x1 = otherAssets != null && otherLiabilities != null ? (otherAssets - otherLiabilities) / ta : 0;
    const x2 = d.reservesCr != null ? d.reservesCr / ta : 0;
    const ebit = ebitCr(d);
    const x3 = ebit != null ? ebit / ta : 0;
    const x4 = sn.marketCapCr / totalLiabExEquity;
    const x5 = d.salesTtmCr != null ? d.salesTtmCr / ta : 0;

    const z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
    let zone, cssClass;
    if (z > 2.99) { zone = 'Safe Zone'; cssClass = 'strong-buy'; }
    else if (z >= 1.81) { zone = 'Grey Zone'; cssClass = 'mild-buy'; }
    else { zone = 'Distress Zone'; cssClass = 'sell'; }

    return { z, zone, cssClass };
  }

  // Acquirer's Multiple = EV / EBIT. Lower is cheaper; <6 is the classic
  // deep-value/takeover-candidate threshold (Tobias Carlisle).
  function acquirersMultiple(d, sn) {
    const ev = enterpriseValueCr(d, sn);
    const ebit = ebitCr(d);
    if (ev == null || ebit == null || ebit <= 0) return null;
    const multiple = ev / ebit;
    return { multiple, cheap: multiple < 6 };
  }

  // Greenblatt's Magic Formula earnings yield = EBIT / EV, as a percentage.
  function magicFormulaYield(d, sn) {
    const ev = enterpriseValueCr(d, sn);
    const ebit = ebitCr(d);
    if (ev == null || ev <= 0 || ebit == null) return null;
    return (ebit / ev) * 100;
  }

  // ROIC vs WACC — is the business creating or destroying shareholder
  // value? Invested Capital = Debt + Equity (Borrowings + Equity Capital +
  // Reserves), all clean, directly-scraped balance sheet rows. WACC uses
  // CAPM for cost of equity with beta defaulted to 1 (market-average) since
  // beta is only computed lazily in the separate Beta & Correlation panel,
  // not fetched as part of the main load — wiring that in here would add
  // another network round-trip to every ticker load. Cost of debt comes
  // from actual interest paid rather than an assumed rate where available.
  function roicVsWacc(d) {
    const pl = (d.tables || {}).profitLoss;
    const ebit = ebitCr(d);
    const taxPct = latestValues(pl, 'tax %', 1)[0];
    const taxRate = taxPct != null && taxPct >= 0 && taxPct < 100 ? taxPct / 100 : 0.25;
    const borrowings = d.borrowingsCr || 0;
    const equity = (d.equityCapitalCr || 0) + (d.reservesCr || 0);
    const investedCapital = borrowings + equity;
    if (ebit == null || investedCapital <= 0) return null;

    const nopat = ebit * (1 - taxRate);
    const roic = (nopat / investedCapital) * 100;

    const riskFreeRate = 7; // approx. 10Y G-Sec — matches Indicators.riskMetrics' Sharpe assumption
    const marketRiskPremium = 6; // approx. long-run Indian equity risk premium
    const beta = 1; // default: not fetched as part of this load, see note above
    const costOfEquity = riskFreeRate + beta * marketRiskPremium;

    const interest = latestValues(pl, 'interest', 1)[0];
    const costOfDebtPretax = interest != null && borrowings > 0 ? (interest / borrowings) * 100 : riskFreeRate + 2;
    const costOfDebtAfterTax = costOfDebtPretax * (1 - taxRate);

    const weightEquity = investedCapital > 0 ? equity / investedCapital : 1;
    const weightDebt = investedCapital > 0 ? borrowings / investedCapital : 0;
    const wacc = weightEquity * costOfEquity + weightDebt * costOfDebtAfterTax;

    return { roic, wacc, creatingValue: roic > wacc, spread: roic - wacc, betaAssumed: true };
  }

  // Rule of 40 — revenue growth % + profit margin % should clear 40 for a
  // growth business to be considered scaling sustainably (originally a
  // SaaS metric, applied loosely here to any growth-stage company).
  function ruleOf40(d, dupont) {
    const revGrowth = d.salesGrowth && d.salesGrowth.ttm != null ? d.salesGrowth.ttm : null;
    const margin = dupont && dupont.netMargin != null ? dupont.netMargin : null;
    if (revGrowth == null || margin == null) return null;
    const score = revGrowth + margin;
    return { score, healthy: score >= 40, revGrowth, margin };
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

  // Z-score of the most recent value against the series' own history —
  // turns "here's a line you can eyeball" into an actual statistical
  // cheap/expensive signal: how many standard deviations from its own
  // average is today's reading?
  function seriesZScore(series) {
    if (!series || !series.values) return null;
    const valid = series.values.filter((v) => v != null);
    if (valid.length < 20) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const variance = valid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / valid.length;
    const stdDev = Math.sqrt(variance);
    const current = series.values[series.values.length - 1];
    if (current == null || stdDev === 0) return null;
    return { current, mean, stdDev, z: (current - mean) / stdDev };
  }

  function drawPriceChart() {
    if (typeof Charts === 'undefined') return;
    const target = state.fullscreenChart ? '#price-chart-fullscreen' : '#price-chart';

    const zNote = $('#ratio-zscore-note');
    if (state.priceMode === 'pe' || state.priceMode === 'pb') {
      if (!state.df) return;
      const t = (state.sheet && state.sheet.tables) || {};
      const series =
        state.priceMode === 'pe'
          ? buildPeSeries(state.df, t.quarterly)
          : buildPbSeries(state.df, t.balanceSheet, state.sheet && state.sheet.sharesOutstandingCr);
      const host = $(target);
      if (!series) {
        if (host)
          host.innerHTML =
            '<p style="color:var(--text-muted);font-size:13px;padding:20px">Not enough data to compute a historical ' +
            state.priceMode.toUpperCase() + ' chart for this stock.</p>';
        if (zNote) zNote.textContent = '';
        return;
      }
      Charts.ratioChart(series.dates, series.values, state.priceMode === 'pe' ? 'P/E Ratio' : 'P/B Ratio', target);
      if (zNote && !state.fullscreenChart) {
        const zs = seriesZScore(series);
        const label = state.priceMode.toUpperCase();
        if (zs) {
          const direction = zs.z <= -1 ? 'below' : zs.z >= 1 ? 'above' : 'near';
          const read = zs.z <= -1 ? 'statistically cheap' : zs.z >= 1 ? 'statistically expensive' : 'roughly fair';
          zNote.innerHTML =
            'Current ' + label + ' of ' + zs.current.toFixed(1) + ' is <b>' + Math.abs(zs.z).toFixed(1) +
            'σ ' + direction + '</b> its own average of ' + zs.mean.toFixed(1) + ' — <b>' + read +
            '</b> relative to its own history (not to peers or the market).';
        } else {
          zNote.textContent = '';
        }
      } else if (zNote) {
        zNote.textContent = '';
      }
      return;
    }
    if (zNote) zNote.textContent = '';

    if (state.intradayInterval && state.intradayDf) {
      Charts.priceChart(state.intradayDf, state.showBollinger, null, 0, target, null, state.chartType);
      return;
    }
    if (!state.df) return;
    const data = Indicators.aggregateOHLC(state.df, state.chartTimeframe);
    const fib = state.fibEnabled ? Indicators.fibonacciLevels(data, 130) : null;
    const fibExt = state.fibEnabled ? Indicators.fibonacciExtensions(data, 130) : null;
    const regressionChannel = state.regressionChannelEnabled ? Indicators.linearRegressionChannel(data, 100) : null;
    const ichimokuData = state.ichimokuEnabled ? Indicators.ichimoku(data) : null;
    let daysToShow = state.chartRange;
    if (daysToShow && state.chartTimeframe === 'W') daysToShow = Math.ceil(daysToShow / 5);
    else if (daysToShow && state.chartTimeframe === 'M') daysToShow = Math.ceil(daysToShow / 21);
    Charts.priceChart(data, state.showBollinger, fib, daysToShow, target, ichimokuData, state.chartType, fibExt, regressionChannel);
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

    // The fullscreen toolbar's own radio group needs to reflect whatever
    // chart type is actually active — it isn't touched by the change
    // listener that fires when fullscreen is first opened via the compact
    // toolbar, since that's a different <input> entirely.
    const fsRadio = document.querySelector('input[name="chart-style-fs"][value="' + state.chartType + '"]');
    if (fsRadio) fsRadio.checked = true;

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
    const divergences = Indicators.detectDivergence(df, 40);
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
    if (divergences.length) {
      html += divergences
        .map(
          (d) =>
            '<div style="margin-bottom:10px;padding-left:10px;border-left:3px solid ' + colorFor[d.type] + '">' +
            '<div style="font-weight:600;color:' + colorFor[d.type] + '">' + d.indicator + ' Divergence (' + d.type + ')</div>' +
            '<div style="font-size:12.5px;color:var(--text-muted)">' + d.note + '</div></div>'
        )
        .join('');
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

  function renderRollingRiskChart(df) {
    const host = $('#rolling-risk-chart');
    if (!host) return;
    const rolling = Indicators.rollingRiskMetrics(df, 30);
    if (!rolling) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Not enough price history for a rolling risk chart.</p>';
      return;
    }
    Charts.rollingRiskChart(rolling.dates, rolling.volatility, rolling.sharpe, 'rolling-risk-chart');
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
    renderBetaCorrelation(df);
    renderRollingRiskChart(df);
  }

  function renderBetaCorrelation(df) {
    const host = $('#beta-correlation');
    if (!host) return;
    host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Loading Nifty 50 benchmark…</p>';
    getBenchmarkDf().then((benchDf) => {
      // Guard against a stale response landing after the user has already
      // switched to a different ticker.
      if (state.df !== df) return;
      if (!benchDf) {
        host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Benchmark data unavailable right now.</p>';
        return;
      }
      const bc = Indicators.betaCorrelation(df, benchDf);
      if (!bc || bc.beta == null) {
        host.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Not enough overlapping history vs Nifty 50.</p>';
        return;
      }
      function card(label, val, cls) {
        return (
          '<div class="metric-card"><div class="label">' + label + '</div>' +
          '<div class="value" style="font-size:17px' + (cls ? ';' + cls : '') + '">' + val + '</div></div>'
        );
      }
      const betaNote =
        bc.beta > 1.2 ? 'More volatile than the market' : bc.beta < 0.8 ? 'Less volatile than the market' : 'Broadly tracks the market';
      host.innerHTML =
        '<div class="metrics-row">' +
        card('Beta (vs Nifty 50)', bc.beta.toFixed(2)) +
        card('Correlation', bc.correlation != null ? bc.correlation.toFixed(2) : '—') +
        '</div>' +
        '<p style="font-size:11.5px;color:var(--text-muted);margin-top:6px">' + betaNote + ' · based on ' + bc.sampleSize + ' overlapping trading days.</p>';
    });
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
      '<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Date</th><th>Verdict</th><th>Price Then</th><th>Change Since</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
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

  // Renders the three independent verdicts (Long-Term, Risk, Valuation) as
  // compact badges. Unlike the master verdict box, these work with only
  // state.sheet present — no chart required — so Screener-only fallback
  // mode still shows real answers instead of nothing.
  // Renders the single reconciled headline above the detail badges.
  function renderBottomLine() {
    const host = $('#bottom-line');
    if (!host) return;
    const bl = state.bottomLine;
    if (!bl) {
      host.innerHTML = '';
      return;
    }
    host.className = 'bottom-line-box ' + bl.cssClass;
    host.innerHTML =
      '<div class="bl-label">🎯 Bottom Line</div>' +
      '<div class="bl-action">' + bl.action + '</div>' +
      '<div class="bl-reason">' + bl.reason + '</div>';
  }

  // Builds the 52-week range gradient bar's inner HTML — shared by the
  // prominent top-of-page widget and the live example in the Learn tab, so
  // they're guaranteed to look identical.
  function week52BarHtml(low, high, current) {
    if (low == null || high == null || current == null || high <= low) return '';
    const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
    const fromHigh = ((current - high) / high) * 100; // 0 or negative
    const badgeUp = fromHigh >= 0;
    return (
      '<div class="w52-header"><span>52-WEEK RANGE</span>' +
      '<span class="w52-badge' + (badgeUp ? ' up' : '') + '">' + (badgeUp ? '+' : '') + fromHigh.toFixed(1) + '% from High</span></div>' +
      '<div class="w52-bar"><div class="w52-dot" style="left:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="w52-labels"><span>L: ' + formatINR(low) + '</span>' +
      '<span class="w52-current">' + formatINR(current) + '</span>' +
      '<span>H: ' + formatINR(high) + '</span></div>'
    );
  }

  // Prominent 52-week range widget near the top of the page, next to the
  // verdicts — previously this data only appeared buried in the Risk &
  // Return section further down.
  function renderW52Highlight() {
    const host = $('#w52-highlight');
    if (!host) return;
    if (!state.df || !state.df.length) {
      host.innerHTML = '';
      return;
    }
    const wk52 = Indicators.week52Range(state.df);
    if (!wk52) {
      host.innerHTML = '';
      return;
    }
    const current = state.info && state.info.currentPrice != null ? state.info.currentPrice : state.df[state.df.length - 1].close;
    host.innerHTML = '<div class="w52-widget">' + week52BarHtml(wk52.low, wk52.high, current) + '</div>';
  }

  // Illustrative example for the Learn tab's 52-Week Range entry — static
  // numbers (matching a real reference example) since Learn works without
  // any ticker loaded.
  function renderW52GlossaryExample() {
    const host = $('#w52-example');
    if (!host || host.dataset.rendered) return;
    host.innerHTML = '<div class="w52-widget">' + week52BarHtml(1226.4, 1611.8, 1226.4) + '</div>';
    host.dataset.rendered = '1';
  }

  // Runs the Monte Carlo simulation for the selected horizon and renders
  // the fan chart + a plain-language results summary. Deliberately framed
  // as a probability range (percentiles), never as a single predicted
  // price — see the tab's own explanation text for why.
  function runMonteCarlo() {
    if (!state.df) return;
    const btn = $('#mc-run-btn');
    const resultEl = $('#mc-result');
    const horizonInput = document.querySelector('input[name="mc-horizon"]:checked');
    const days = horizonInput ? parseInt(horizonInput.value, 10) : 63;
    const methodInput = document.querySelector('input[name="mc-method"]:checked');
    const method = methodInput ? methodInput.value : 'gbm';
    const numSims = 200;

    if (btn) { btn.disabled = true; btn.textContent = 'Simulating…'; }
    // Let the button's disabled state paint before the CPU-bound simulation
    // runs on the main thread — a few hundred paths over up to a year of
    // steps is fast (well under a second) but not instant.
    setTimeout(() => {
      const result =
        method === 'bootstrap'
          ? Indicators.bootstrapSim(state.df, days, numSims)
          : Indicators.monteCarloSim(state.df, days, numSims);
      if (!result) {
        if (resultEl) resultEl.textContent = 'Not enough price history to run a simulation for this stock.';
        if (btn) { btn.disabled = false; btn.textContent = 'Run Simulation'; }
        return;
      }
      Charts.monteCarloChart(result.simMatrix);
      const horizonLabel = days === 21 ? '1 month' : days === 63 ? '3 months' : days === 126 ? '6 months' : '1 year';
      const methodLabel = method === 'bootstrap' ? 'Historical Bootstrap' : 'Normal (GBM)';
      if (resultEl) {
        resultEl.innerHTML =
          'Over the next <b>' + horizonLabel + '</b> — <b>' + methodLabel + '</b> (' + numSims + ' simulated paths, ' +
          result.annualVolPct.toFixed(1) + '% annualized volatility):<br>' +
          '10th percentile: <b>' + formatINR(result.p10) + '</b> &nbsp;·&nbsp; ' +
          'Median: <b>' + formatINR(result.p50) + '</b> &nbsp;·&nbsp; ' +
          '90th percentile: <b>' + formatINR(result.p90) + '</b><br>' +
          "Probability of being above today's price (" + formatINR(result.lastPrice) + '): <b>' +
          (result.probAbove * 100).toFixed(0) + '%</b><br>' +
          '<span style="color:var(--red)">95% VaR: <b>' + result.var95.toFixed(1) + '%</b> &nbsp;·&nbsp; ' +
          'Expected Shortfall (CVaR 95%): <b>' + result.cvar95.toFixed(1) + '%</b></span>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">' +
          'In the worst 5% of simulated outcomes, the average loss was ' + Math.abs(result.cvar95).toFixed(1) +
          '% — a fuller picture of the downside tail than VaR alone.</div>';
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Run Simulation'; }
    }, 30);
  }

  function renderTechnicalSummary() {
    const host = $('#technical-summary');
    if (!host) return;
    const ts = state.technicalSummary;
    if (!ts) {
      host.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted)">Not enough price history for a full technical read.</p>';
      return;
    }
    const overallHtml =
      '<div class="verdict-badge ' + ts.cssClass + '" style="margin-bottom:14px">' +
      '<div class="vb-label">Overall Short-Term Read</div>' +
      '<div class="vb-tag">' + ts.overall + '</div>' +
      '<div class="vb-reason">' + ts.bull + ' bullish vs ' + ts.bear + ' bearish signals, across ' + ts.categories.length + ' categories.</div>' +
      '</div>';
    const categoriesHtml = ts.categories
      .filter((c) => c.signals.length)
      .map((c) => {
        const items = c.signals
          .map((s) => {
            const color = s.bullish === true ? 'var(--green)' : s.bullish === false ? 'var(--red)' : 'var(--text-muted)';
            const arrow = s.bullish === true ? '▲' : s.bullish === false ? '▼' : '●';
            return '<li style="font-size:12.5px;margin-bottom:4px;color:' + color + '">' + arrow + ' ' + s.text + '</li>';
          })
          .join('');
        return (
          '<div style="margin-bottom:12px"><div style="font-weight:700;font-size:13px;margin-bottom:4px;color:var(--text)">' +
          c.name + '</div><ul style="list-style:none;padding:0;margin:0">' + items + '</ul></div>'
        );
      })
      .join('');
    host.innerHTML = overallHtml + categoriesHtml;
  }

  function renderVerdictBadges() {
    const host = $('#extra-verdicts');
    if (!host) return;
    const badges = [];

    const lt = state.longTermVerdict;
    if (lt) {
      badges.push(
        '<div class="verdict-badge ' + lt.cssClass + '">' +
        '<div class="vb-label">Long-Term Investment</div>' +
        '<div class="vb-tag">' + lt.verdict + '</div>' +
        '<div class="vb-reason">' + lt.summary + '</div></div>'
      );
    }
    const risk = state.riskVerdict;
    if (risk) {
      badges.push(
        '<div class="verdict-badge ' + risk.cssClass + '">' +
        '<div class="vb-label">Risk Level</div>' +
        '<div class="vb-tag">' + risk.level + '</div>' +
        '<div class="vb-reason">' + risk.reasons.slice(0, 2).join(' ') + '</div></div>'
      );
    }
    const val = state.valuationVerdict;
    if (val) {
      badges.push(
        '<div class="verdict-badge ' + val.cssClass + '">' +
        '<div class="vb-label">Valuation</div>' +
        '<div class="vb-tag">' + val.tag + '</div>' +
        '<div class="vb-reason">' + val.reasons.slice(0, 2).join(' ') + '</div></div>'
      );
    }
    const nb = state.nbScore;
    if (nb) {
      badges.push(
        '<div class="verdict-badge ' + nb.cssClass + '">' +
        '<div class="vb-label">NB Score</div>' +
        '<div class="vb-tag">' + nb.score + ' / ' + nb.max + ' — ' + nb.tag + '</div>' +
        '<div class="vb-reason">' + nb.checks.filter((c) => c.pass !== null).length + ' checks evaluated (3 chart + 7 fundamental)</div></div>'
      );
    }
    host.innerHTML = badges.join('');
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
      renderBottomLine();
      renderVerdictBadges();
      renderW52Highlight();
      renderValuationWidgets(null);
      renderSheetDashboard(state.sheet);
      renderVerdictHistory(state.rawInput);
      // On mobile, jump straight to the Fundamentals zone — the Home/Verdict
      // zone has nothing to show here (bull/bear and the metrics row all
      // depend on chart data that never loaded), while the actual growth/
      // valuation/pros-cons content the "still available" message promises
      // lives in the Fundamentals zone, which nothing was switching to.
      showMobileZone('zone-fundamentals');
      $$('.mnav-btn[data-nav]').forEach((b) => b.classList.remove('active'));
      const fundNavBtn = document.querySelector('.mnav-btn[data-nav="fundamentals"]');
      if (fundNavBtn) fundNavBtn.classList.add('active');
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
    $('#m-price').textContent = formatINR(livePx);
    $('#m-rsi').textContent = last.rsi != null ? last.rsi.toFixed(1) : '—';
    $('#m-macd').textContent = last.macdHist != null ? last.macdHist.toFixed(2) : '—';
    $('#m-bull').textContent = (v.bullRatio * 100).toFixed(1) + '%';
    renderBottomLine();
    renderVerdictBadges();
    renderW52Highlight();

    if (state.df) drawPriceChart();
    renderCandlestickPatterns(state.df);
    renderTechnicalSummary();
    renderRiskMetrics(state.df, state.sheet);
    renderMultiTimeframeConfluence();
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

    // ---- Long-Term Compounding Calculator ----
    const ccPriceEl = $('#cc-price');
    const ccCagrEl = $('#cc-cagr');
    const ccYearsEl = $('#cc-years');
    const ccSipEl = $('#cc-sip');
    if (ccPriceEl && ccCagrEl && ccYearsEl) {
      if (!ccPriceEl.value) {
        if (info.currentPrice != null) ccPriceEl.value = Number(info.currentPrice).toFixed(2);
        else if (d.snapshot && d.snapshot.currentPrice != null) {
          ccPriceEl.value = Number(d.snapshot.currentPrice).toFixed(2);
        }
      }
      if (!ccCagrEl.value) {
        const pc = d.priceCagr || {};
        ccCagrEl.value = pc.y5 != null ? pc.y5 : pc.y3 != null ? pc.y3 : defaultGrowth;
      }

      function updateCompounding() {
        const price = parseFloat(ccPriceEl.value) || 0;
        const cagr = parseFloat(ccCagrEl.value) || 0;
        const years = parseFloat(ccYearsEl.value) || 0;
        const sip = parseFloat((ccSipEl && ccSipEl.value) || '') || 0;
        const resultEl = $('#cc-result');
        if (!resultEl) return;
        if (price <= 0 || years <= 0) {
          resultEl.textContent = 'Enter current price and years';
          return;
        }
        const r = cagr / 100;
        const lumpsumFv = price * Math.pow(1 + r, years);
        let html =
          'Lumpsum ₹' + fmt(price, 2) + ' → <strong>' + formatINR(lumpsumFv) +
          '</strong> in ' + years + ' yrs (at ' + cagr + '% CAGR)';

        if (sip > 0) {
          // Standard SIP future-value formula, compounded monthly.
          const monthlyR = Math.pow(1 + r, 1 / 12) - 1;
          const n = years * 12;
          const sipFv =
            monthlyR > 0
              ? sip * ((Math.pow(1 + monthlyR, n) - 1) / monthlyR) * (1 + monthlyR)
              : sip * n;
          const invested = sip * n;
          html +=
            '<br>SIP ₹' + fmt(sip, 0) + '/month → <strong>' + formatINR(sipFv) +
            '</strong> (invested ' + formatINR(invested) + ')';
        }
        resultEl.innerHTML = html;
      }
      ccPriceEl.oninput = ccCagrEl.oninput = ccYearsEl.oninput = updateCompounding;
      if (ccSipEl) ccSipEl.oninput = updateCompounding;
      updateCompounding();
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

  // Runs the verdict/indicator pipeline against a DataService.loadAll()
  // result and stores it on state. Shared by the initial load and by
  // retryChart() so both paths compute the verdict identically. Returns
  // true if a usable chart was found (>=30 bars), false otherwise.
  // Rebuilds verdictInfo from whatever state.df/state.sheet currently hold
  // and recomputes all four verdicts (master, long-term, risk, valuation).
  // Called when the chart first loads or is retried, AND when fundamentals
  // arrive later via retryFundamentals() — so a late fundamentals fetch
  // still enriches verdicts that were already computed on chart-only data,
  // instead of those verdicts staying stuck on stale/missing info forever.
  // Each verdict is computed independently of the others' data
  // availability: Long-Term and Valuation only need state.sheet, Risk can
  // work from debt alone without price history, so Screener-only fallback
  // mode (no chart) still gets real answers instead of nothing.
  function recomputeVerdict() {
    const verdictInfo = Object.assign({}, state.info);
    const lastClose = state.df && state.df.length ? state.df[state.df.length - 1].close : null;
    verdictInfo.price = lastClose != null ? lastClose : (state.info && state.info.currentPrice != null ? state.info.currentPrice : null);

    if (state.sheet) {
      const sn = state.sheet.snapshot || {};
      const gf = grahamFormulaFairValue(state.sheet);
      const lv = lynchFairValue(state.sheet);
      verdictInfo.grahamFormulaValue = gf ? gf.value : null;
      verdictInfo.lynchValue = lv ? lv.value : null;
      verdictInfo.growthFloored = (gf && gf.floored) || (lv && lv.floored) || false;
      verdictInfo.piotroski = piotroskiFScore(state.sheet);
      verdictInfo.dupont = duPontAnalysis(state.sheet, sn);

      // Quality/moat trend signals — same computation qualityMoatSection()
      // uses for display, reused here so the verdict and the dashboard
      // never disagree about which way a trend is heading.
      const t = state.sheet.tables || {};
      verdictInfo.qualityTrends = [
        trendVerdict('Promoter Holding', trendRow(t.shareholding, 'promoter'), { goodDirection: 'up' }),
        trendVerdict('FII Holding', trendRow(t.shareholding, 'fii'), { goodDirection: 'up' }),
        trendVerdict('DII Holding', trendRow(t.shareholding, 'dii'), { goodDirection: 'up' }),
        trendVerdict('Return on Equity', trendRow(t.ratios, 'return on equity') || trendRow(t.ratios, 'roe'), { goodDirection: 'up' }),
        trendVerdict('ROCE', trendRow(t.ratios, 'roce'), { goodDirection: 'up' }),
        trendVerdict('Borrowings (Debt)', trendRow(t.balanceSheet, 'borrowings'), { goodDirection: 'down', unit: ' Cr' })
      ].filter(Boolean);

      // Same PEG / FCF yield formulas as the Advanced Ratios card.
      const growthForPeg = state.sheet.profitGrowth && state.sheet.profitGrowth.y5 != null ? state.sheet.profitGrowth.y5 : null;
      if (sn.stockPE != null && growthForPeg != null && growthForPeg > 0) {
        verdictInfo.peg = sn.stockPE / growthForPeg;
      }
      if (state.sheet.freeCashflowCr != null && sn.marketCapCr != null && sn.marketCapCr > 0) {
        verdictInfo.fcfYield = (state.sheet.freeCashflowCr / sn.marketCapCr) * 100;
      }
      verdictInfo.profitGrowthY3 = state.sheet.profitGrowth && state.sheet.profitGrowth.y3 != null ? state.sheet.profitGrowth.y3 : null;
      verdictInfo.salesGrowthY3 = state.sheet.salesGrowth && state.sheet.salesGrowth.y3 != null ? state.sheet.salesGrowth.y3 : null;

      // Advanced financial models — Altman Z-Score, Acquirer's Multiple,
      // Magic Formula yield, ROIC vs WACC, Rule of 40. See each function's
      // own comments for data-availability caveats (Altman's X1 in
      // particular is approximated).
      verdictInfo.altman = altmanZScore(state.sheet, sn);
      verdictInfo.acquirersMultiple = acquirersMultiple(state.sheet, sn);
      verdictInfo.magicFormulaYield = magicFormulaYield(state.sheet, sn);
      verdictInfo.roicWacc = roicVsWacc(state.sheet);
      verdictInfo.ruleOf40 = ruleOf40(state.sheet, verdictInfo.dupont);
    }

    if (state.df) {
      verdictInfo.riskMetrics = Indicators.riskMetrics(state.df);
      Object.assign(verdictInfo, fibProximity(state.df));
      verdictInfo.candlePatterns = Indicators.detectCandlestickPatterns(state.df);
      verdictInfo.divergences = Indicators.detectDivergence(state.df, 40);
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
      const lastRow = state.df[state.df.length - 1];
      verdictInfo.sma200 = lastRow.sma200;
      verdictInfo.macdHist = lastRow.macdHist;

      state.verdict = VerdictEngine.analyse(state.df, verdictInfo);
      if (state.verdict && state.rawInput) {
        saveVerdictHistoryEntry(state.rawInput, {
          date: new Date().toISOString().slice(0, 10),
          master: state.verdict.master,
          bullRatio: state.verdict.bullRatio,
          price: verdictInfo.price
        });
      }
    } else {
      state.verdict = null;
    }

    state.longTermVerdict = state.sheet ? VerdictEngine.analyseLongTerm(verdictInfo) : null;
    state.riskVerdict = VerdictEngine.riskLevel(verdictInfo);
    state.valuationVerdict = state.sheet ? VerdictEngine.valuationVerdict(verdictInfo) : null;
    state.nbScore = VerdictEngine.nbScore(verdictInfo);
    state.technicalSummary = state.df ? VerdictEngine.technicalSummary(state.df, verdictInfo) : null;
    state.bottomLine = synthesizeBottomLine();
  }

  // Reconciles the four separate verdicts into ONE plain-language action,
  // so four differently-colored badges never leave the person unsure what
  // to actually do. The badges stay visible below as supporting detail for
  // whoever wants the "why" — this is deliberately the only thing that
  // needs reading if that's all someone wants.
  function synthesizeBottomLine() {
    const lt = state.longTermVerdict;
    const val = state.valuationVerdict;
    const risk = state.riskVerdict;
    const master = state.verdict;

    if (!lt && !val) return null; // nothing fundamental to go on at all

    let action, cssClass, reason;

    if (lt && lt.verdict === 'LONG-TERM BUY' && val && (val.tag === 'Cheap' || val.tag === 'Fair')) {
      action = 'Worth considering for a long-term position';
      cssClass = 'strong-buy';
      reason = 'Fundamentals are strong and the price looks ' + (val.tag === 'Cheap' ? 'cheap' : 'reasonable') + '.';
    } else if (lt && lt.verdict === 'LONG-TERM BUY' && val && val.tag === 'Expensive') {
      action = 'Good business, but not at this price';
      cssClass = 'mild-buy';
      reason = 'Fundamentals support a long-term hold, but valuation looks rich right now — consider waiting for a better entry, or a phased/SIP approach instead of a lump sum.';
    } else if (lt && lt.verdict === 'LONG-TERM BUY') {
      action = 'Worth considering for a long-term position';
      cssClass = 'strong-buy';
      reason = 'Fundamentals are strong (valuation read unavailable).';
    } else if (lt && lt.verdict === 'ACCUMULATE / HOLD') {
      action = 'A tentative hold/accumulate, not a strong buy';
      cssClass = 'mild-buy';
      reason = 'The long-term case is net positive but not one-sided.';
    } else if (lt && lt.verdict === 'HOLD / WATCH') {
      action = 'Not a clear buy or sell right now';
      cssClass = 'neutral';
      reason = 'Fundamentals are mixed — worth watching rather than acting on immediately.';
    } else if (lt && lt.verdict === 'AVOID / REDUCE') {
      action = 'Fundamentals argue against buying here';
      cssClass = 'sell';
      reason = 'Weak or deteriorating fundamentals outweigh the positives for a long-term hold.';
    } else if (val) {
      // No long-term verdict computed (not enough fundamental checks) — fall back to valuation alone.
      action = val.tag === 'Cheap' ? 'Valuation looks attractive, but check fundamentals too'
        : val.tag === 'Expensive' ? 'Valuation looks rich'
        : 'Fairly valued';
      cssClass = val.tag === 'Cheap' ? 'strong-buy' : val.tag === 'Expensive' ? 'sell' : 'neutral';
      reason = 'Not enough fundamental data for a full long-term read — valuation only.';
    } else {
      return null;
    }

    const notes = [];
    if (risk && risk.level === 'High') {
      notes.push('This carries above-average risk — size any position with that in mind.');
    }
    if (master && master.latest) {
      const shortTermBearish = master.bullRatio < 0.4;
      const shortTermBullish = master.bullRatio > 0.6;
      if (cssClass !== 'sell' && shortTermBearish) {
        notes.push('Short-term technicals look weak right now — if buying, consider a phased entry rather than all at once.');
      } else if (cssClass === 'sell' && shortTermBullish) {
        notes.push('Short-term momentum looks strong despite the fundamental concerns — a caution for new positions, not necessarily a signal to sell immediately if already holding.');
      }
    }

    return { action, cssClass, reason: reason + (notes.length ? ' ' + notes.join(' ') : '') };
  }

  function applyChartResult(chartRes) {
    if (chartRes.history && chartRes.history.length >= 30) {
      state.df = Indicators.calculateAll(chartRes.history);
      recomputeVerdict();
      return true;
    }
    state.df = null;
    recomputeVerdict();
    return false;
  }

  // Central place that decides what the warning banner says and which
  // retry button(s) it shows, based purely on current state. Called after
  // the initial load and after every retry, so the UI always reflects
  // reality: a chart-only retry button when fundamentals are fine, a
  // fundamentals-only retry button when the chart is fine, no buttons (just
  // a prompt to re-run Analyse) if both are missing, and nothing at all
  // once both are healthy.
  function renderDataWarning() {
    const box = $('#error-box');
    if (!box) return;
    const chartMissing = !state.df;
    const sheetMissing = !state.sheet;
    const sheetUnstable = !!(state.sheet && state.sheet.stable === false);

    if (!chartMissing && !sheetMissing && !sheetUnstable) {
      hide(box);
      return;
    }

    let message;
    const buttons = [];
    if (chartMissing && sheetMissing) {
      message = 'Could not load the price chart or fundamentals. Try analysing again.';
    } else if (chartMissing) {
      message = 'Price chart unavailable. Fundamentals and valuation still available.';
      buttons.push('<button type="button" id="retry-chart-btn" class="retry-data-btn">🔄 Retry Chart</button>');
    } else {
      message = sheetUnstable
        ? 'Some fundamentals may still be loading.'
        : 'Fundamentals unavailable. Price chart and technical verdict still available.';
      buttons.push('<button type="button" id="retry-fundamentals-btn" class="retry-data-btn">🔄 Retry Fundamentals</button>');
    }

    box.innerHTML =
      '<div>' + message + '</div>' +
      (buttons.length
        ? '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' + buttons.join('') + '</div>'
        : '');
    box.classList.remove('hidden');
    show(box);

    const retryChartBtn = $('#retry-chart-btn');
    if (retryChartBtn) retryChartBtn.addEventListener('click', retryChart);
    const retryFundBtn = $('#retry-fundamentals-btn');
    if (retryFundBtn) retryFundBtn.addEventListener('click', () => retryFundamentals());
  }

  let chartRetryInFlight = false;
  async function retryChart() {
    if (chartRetryInFlight || !state.ticker) return false;
    chartRetryInFlight = true;
    const btn = $('#retry-chart-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
    const chartRes = await DataService.loadAll(state.ticker);
    state.info = chartRes.info || {};
    const ok = applyChartResult(chartRes);
    setWorkspace(state.view === 'market' ? 'market' : 'quant');
    renderDataWarning();
    chartRetryInFlight = false;
    return ok;
  }

  let fundamentalsRetryInFlight = false;
  async function retryFundamentals() {
    if (fundamentalsRetryInFlight || !state.rawInput) return false;
    fundamentalsRetryInFlight = true;
    const btn = $('#retry-fundamentals-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
    let ok = false;
    try {
      const res = await sheetsJsonp({ action: 'analyse', ticker: state.rawInput }, SHEETS_ANALYSE_TIMEOUT_MS);
      if (res && res.ok && res.data) {
        applySheet(res.data);
        recomputeVerdict();
        ok = true;
      }
    } catch (e) {
      console.warn('Fundamentals retry failed:', e);
    }
    setWorkspace(state.view === 'market' ? 'market' : 'quant');
    renderDataWarning();
    fundamentalsRetryInFlight = false;
    return ok;
  }

  // Auto-retries the fundamentals fetch in the background (no button press
  // needed) when the initial read failed or couldn't be confirmed stable,
  // since slow IMPORTHTML tables often just need more real time. 25s delay
  // clears the backend's own 20s short-cache TTL for unstable reads, so
  // this actually re-scrapes instead of replaying the same partial result.
  // The manual "Retry Fundamentals" button (renderDataWarning) uses the
  // same retryFundamentals() function, so a button click and an automatic
  // retry never race each other or duplicate work.
  function scheduleSheetRetry(raw, attemptsLeft) {
    if (attemptsLeft <= 0) return;
    setTimeout(async () => {
      if (state.rawInput !== raw) return; // user moved on to another ticker
      const ok = await retryFundamentals();
      if (state.rawInput !== raw) return; // still guard after the await
      if (!ok || (state.sheet && state.sheet.stable === false)) {
        scheduleSheetRetry(raw, attemptsLeft - 1);
      }
    }, 25000);
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
    const intervalSelFs = $('#chart-interval-fs');
    if (intervalSelFs) intervalSelFs.value = 'D';
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
    ['#graham-eps', '#graham-bvps', '#gf-eps', '#gf-growth', '#pl-eps', '#pl-growth', '#cc-price', '#cc-cagr'].forEach((sel) => {
      const el = $(sel);
      if (el) el.value = '';
    });
    // Clear the sticky LTP/P/E header too — it only gets refreshed once the
    // new ticker's data arrives, so without this it keeps showing the
    // previous ticker's price/P/E for the entire load, which reads as if
    // the new search did nothing yet.
    updateStickyQuote(null);

    hide($('#main-content'));
    hide($('#error-box'));
    show($('#loading'));
    const loadMsg = $('#loading');
    if (loadMsg) loadMsg.innerHTML = '<div class="spinner"></div><div>Loading…</div>';

    // Fundamentals can take up to ~3 minutes when several IMPORTHTML tables
    // on the Screener sheet are slow to resolve — update the message over
    // time so a long wait doesn't look like the page has frozen.
    let loadSecs = 0;
    const progressTimer = setInterval(() => {
      loadSecs += 5;
      if (loadMsg && loadSecs >= 15) {
        loadMsg.innerHTML =
          '<div class="spinner"></div><div>Still loading fundamentals… (' + loadSecs +
          's) — some tickers take a couple of minutes.</div>';
      }
    }, 5000);

    try {
      // Parallel: Yahoo chart + Sheets Screener
      const chartPromise = DataService.loadAll(state.ticker);
      const sheetPromise = sheetsJsonp({ action: 'analyse', ticker: raw }, SHEETS_ANALYSE_TIMEOUT_MS).catch((e) => {
        console.warn(e);
        return null;
      });

      const [chartRes, sheetRes] = await Promise.all([chartPromise, sheetPromise]);
      clearInterval(progressTimer);

      state.info = chartRes.info || {};

      if (sheetRes && sheetRes.ok && sheetRes.data) {
        applySheet(sheetRes.data);
      }

      applyChartResult(chartRes);

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
      const displayName = (state.sheet && state.sheet.companyName) || state.rawInput;
      $('#asset-title').textContent = 'Strategic Asset Intelligence Center (' + displayName + ')';

      if (state.view === 'market') {
        setWorkspace('market');
      } else {
        setWorkspace('quant');
      }

      updateTvLink();

      // Shows the "chart unavailable" / "fundamentals unavailable" banner
      // with the appropriate single retry button, or nothing if both loaded.
      renderDataWarning();

      // If the sheet fetch failed outright, or came back but couldn't be
      // confirmed stable within the server's own wait window, retry it in
      // the background a couple of times rather than leaving the page stuck
      // on a partial read — a slow IMPORTHTML scrape often just needs more
      // real time, not a fresh request. The manual "Retry Fundamentals"
      // button shown by renderDataWarning() calls the same function, so
      // there's never a duplicate in-flight request.
      const sheetUnstable = !!(state.sheet && state.sheet.stable === false);
      if (!state.sheet || sheetUnstable) {
        scheduleSheetRetry(raw, 2);
      }
    } catch (err) {
      clearInterval(progressTimer);
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

    // The chart is drawn as soon as a ticker loads, but the default zone
    // shown right after loading is zone-verdict, not zone-chart — so Plotly
    // measures a display:none (0×0) container at draw time and renders
    // nothing. It never self-corrects once the zone later becomes visible
    // (same root cause the fullscreen overlay already needed a resize nudge
    // for), so switching into this zone has to explicitly force a redraw.
    if (zoneId === 'zone-chart' && state.view === 'market') {
      setTimeout(() => drawPriceChart(), 50);
    }
  }

  function setWorkspace(view, navKey, mobileZone) {
    state.view = view;
    const radio = document.querySelector('input[name="workspace"][value="' + view + '"]');
    if (radio) radio.checked = true;
    $$('.mnav-btn[data-nav]').forEach((b) => b.classList.remove('active'));
    const key = navKey || (view === 'market' ? 'home' : view === 'learn' ? 'more' : 'quality');
    const navBtn = document.querySelector('.mnav-btn[data-nav="' + key + '"]');
    if (navBtn) navBtn.classList.add('active');

    const backHomeBtn = $('#mobile-back-home');
    if (backHomeBtn) backHomeBtn.style.display = view === 'quant' ? '' : 'none';

    // Learn is static educational content — deliberately doesn't require a
    // ticker to be loaded, so a first-time visitor can read it before ever
    // searching for a stock.
    if (view === 'learn') {
      hide($('#view-market'));
      hide($('#view-quant'));
      show($('#view-learn'));
      renderW52GlossaryExample();
      return;
    }
    hide($('#view-learn'));

    if (!state.df && !state.sheet) return;
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
          const text = generateTextReport();
          const shareDisplayName = (state.sheet && state.sheet.companyName) || state.rawInput || 'Stock';
          const title = shareDisplayName + ' Analysis Report';
          if (navigator.share) {
            await navigator.share({ title, text });
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            alert('Sharing isn\'t supported in this browser — report copied to clipboard, paste it into WhatsApp.');
          } else {
            alert("Couldn't share or copy automatically — this browser supports neither.");
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
    $$('.more-item[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setWorkspace(btn.dataset.view);
        closeMoreSheet();
      });
    });
    const moreBackdrop = $('#more-sheet-backdrop');
    if (moreBackdrop) moreBackdrop.addEventListener('click', closeMoreSheet);
    // Compact and fullscreen toolbars are two separate DOM locations showing
    // the same underlying state — these helpers keep both in sync instead
    // of duplicating the change-handling logic for each pair.
    function syncCheckboxPair(idMain, idFs, stateKey) {
      const a = $(idMain);
      const b = $(idFs);
      function apply(checked) {
        state[stateKey] = checked;
        if (a) a.checked = checked;
        if (b) b.checked = checked;
        if (state.view === 'market') drawPriceChart();
      }
      if (a) a.addEventListener('change', () => apply(a.checked));
      if (b) b.addEventListener('change', () => apply(b.checked));
    }
    $$('input[name="price-mode"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        state.priceMode = e.target.value;
        if (state.view === 'market') drawPriceChart();
      });
    });
    syncCheckboxPair('#show-bb', '#show-bb-fs', 'showBollinger');
    syncCheckboxPair('#show-fib', '#show-fib-fs', 'fibEnabled');
    syncCheckboxPair('#show-ichimoku', '#show-ichimoku-fs', 'ichimokuEnabled');
    syncCheckboxPair('#show-regression', '#show-regression-fs', 'regressionChannelEnabled');

    function wireIntervalSelect(sel) {
      if (!sel) return;
      sel.addEventListener('change', (e) => {
        const val = e.target.value;
        const other = sel.id === 'chart-interval' ? $('#chart-interval-fs') : $('#chart-interval');
        if (other) other.value = val;
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
    wireIntervalSelect($('#chart-interval'));
    wireIntervalSelect($('#chart-interval-fs'));

    function wireRangeRadios(name) {
      $$('input[name="' + name + '"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          state.chartRange = parseInt(e.target.value, 10) || 0;
          const otherName = name === 'chart-range' ? 'chart-range-fs' : 'chart-range';
          const other = document.querySelector('input[name="' + otherName + '"][value="' + e.target.value + '"]');
          if (other) other.checked = true;
          if (state.view === 'market') drawPriceChart();
        });
      });
    }
    wireRangeRadios('chart-range');
    wireRangeRadios('chart-range-fs');

    // Chart type toggle — a clear 2-state radio group (not a flip-label
    // button) so the active style is always visually unambiguous. Selecting
    // Candlestick from the compact toolbar also opens fullscreen, since
    // candlesticks only really work with the extra room fullscreen
    // provides; selecting it from inside fullscreen (already open) or
    // selecting Line from either toolbar just redraws in place.
    function wireChartStyleRadios(name) {
      $$('input[name="' + name + '"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          const value = e.target.value;
          state.chartType = value;
          const otherName = name === 'chart-style' ? 'chart-style-fs' : 'chart-style';
          const other = document.querySelector('input[name="' + otherName + '"][value="' + value + '"]');
          if (other) other.checked = true;
          if (value === 'candlestick' && !state.fullscreenChart) {
            openChartFullscreen();
          } else if (state.view === 'market') {
            drawPriceChart();
          }
        });
      });
    }
    wireChartStyleRadios('chart-style');
    wireChartStyleRadios('chart-style-fs');

    const mcRunBtn = $('#mc-run-btn');
    $$('input[name="mc-method"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const note = $('#mc-method-note');
        if (note) {
          note.textContent =
            e.target.value === 'bootstrap'
              ? 'Resamples this stock\'s own actual historical daily returns — captures real fat tails and skew instead of assuming a bell curve.'
              : 'GBM assumes daily returns follow a normal distribution — simple, but smooths over real market fat tails.';
        }
      });
    });
    if (mcRunBtn) mcRunBtn.addEventListener('click', runMonteCarlo);

    const peerBtn = $('#peer-compare-btn');
    if (peerBtn) peerBtn.addEventListener('click', runPeerComparison);
    const csvBtn = $('#csv-export-btn');
    if (csvBtn) csvBtn.addEventListener('click', exportCsv);
    // Shorter default range on mobile — a full year of daily candles
    // squeezed into a phone-width chart reads as a solid smear rather than
    // individual candles. Desktop keeps the 1Y default (HTML checkbox
    // default), unchanged.
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      state.chartRange = 126;
      const sixM = document.querySelector('input[name="chart-range"][value="126"]');
      if (sixM) sixM.checked = true;
      const sixMFs = document.querySelector('input[name="chart-range-fs"][value="126"]');
      if (sixMFs) sixMFs.checked = true;
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
