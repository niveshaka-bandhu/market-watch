// ========== PASTE YOUR APPS SCRIPT WEB APP URL HERE ==========
const SHEETS_API = 'https://script.google.com/macros/s/AKfycbz80s_zIs0o_bUdZM4Sl6AkhAR4SEUmo5GM3WGjkxQPF_-WytVBMxHe4A14HkgsZpat/exec';
// ============================================================

const App = (() => {
  let state = {
    ticker: '',
    rawInput: '',
    df: null,
    info: {},
    verdict: null,
    showBollinger: true,
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
      }, 45000);
      function cleanup() {
        clearTimeout(t);
        try { delete window[cb]; } catch (e) {}
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

  async function loadEquityList() {
    try {
      const res = await sheetsJsonp({ action: 'equity' });
      if (res && res.ok && Array.isArray(res.data)) {
        equityIndex = res.data;
        console.log('Equity loaded:', equityIndex.length);
      }
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

    function card(label, val) {
      return (
        '<div class="metric-card"><div class="label">' +
        label +
        '</div><div class="value" style="font-size:15px">' +
        val +
        '</div></div>'
      );
    }

    const g = d.salesGrowth || {};
    const pg = d.profitGrowth || {};
    const roe = d.roe || {};
    const pc = d.priceCagr || {};

    host.innerHTML =
      '<div class="card" style="margin-top:16px">' +
      '<h3>📄 Full Screener snapshot — ' +
      (d.ticker || '') +
      '</h3>' +
      (d.about
        ? '<p style="font-size:13px;color:var(--text-muted);line-height:1.5;margin:8px 0 14px">' +
          d.about +
          '</p>'
        : '') +
      '<div class="two-col">' +
      '<div><strong style="color:var(--green)">Pros</strong><ul class="bull-list">' +
      ((d.pros || []).map((p) => '<li>' + p + '</li>').join('') || '<li>—</li>') +
      '</ul></div>' +
      '<div><strong style="color:var(--red)">Cons</strong><ul class="bear-list">' +
      ((d.cons || []).map((c) => '<li>' + c + '</li>').join('') || '<li>—</li>') +
      '</ul></div></div>' +
      '<div class="section-title" style="margin-top:16px">Key fundamentals (used in valuation)</div>' +
      '<div class="metrics-row">' +
      card('TTM EPS (₹)', fmt(d.trailingEps)) +
      card('Book Value (₹)', fmt(d.bookValue)) +
      card('FCF (₹ Cr)', fmt(d.freeCashflowCr, 0)) +
      card('Shares (Cr)', fmt(d.sharesOutstandingCr, 2)) +
      card('Sales TTM (₹ Cr)', fmt(d.salesTtmCr, 0)) +
      card('PAT TTM (₹ Cr)', fmt(d.patTtmCr, 0)) +
      card('OPM %', d.opmTtm != null ? d.opmTtm + '%' : '—') +
      card('ROCE %', d.roce != null ? d.roce + '%' : '—') +
      '</div>' +
      '<div class="section-title" style="margin-top:16px">Growth & returns</div>' +
      '<div class="metrics-row">' +
      card('Sales 10Y', g.y10 != null ? g.y10 + '%' : '—') +
      card('Sales 5Y', g.y5 != null ? g.y5 + '%' : '—') +
      card('Profit 10Y', pg.y10 != null ? pg.y10 + '%' : '—') +
      card('Profit TTM', pg.ttm != null ? pg.ttm + '%' : '—') +
      card('ROE 10Y', roe.y10 != null ? roe.y10 + '%' : '—') +
      card('ROE Last Yr', roe.last != null ? roe.last + '%' : '—') +
      card('Price CAGR 5Y', pc.y5 != null ? pc.y5 + '%' : '—') +
      card('Price 1Y', pc.y1 != null ? pc.y1 + '%' : '—') +
      '</div>' +
      '<div class="section-title" style="margin-top:16px">Balance sheet (₹ Cr)</div>' +
      '<div class="metrics-row">' +
      card('Equity capital', fmt(d.equityCapitalCr, 0)) +
      card('Reserves', fmt(d.reservesCr, 0)) +
      card('Borrowings', fmt(d.borrowingsCr, 0)) +
      card('Total assets', fmt(d.totalAssetsCr, 0)) +
      card('CFO', fmt(d.cfoCr, 0)) +
      card('FCF', fmt(d.freeCashflowCr, 0)) +
      '</div>' +
      '<div class="section-title" style="margin-top:16px">Shareholding</div>' +
      '<div class="metrics-row">' +
      card('Promoters', d.promoters != null ? d.promoters + '%' : '—') +
      card('FII', d.fiis != null ? d.fiis + '%' : '—') +
      card('DII', d.diis != null ? d.diis + '%' : '—') +
      card('Government', d.government != null ? d.government + '%' : '—') +
      card('Public', d.publicPct != null ? d.publicPct + '%' : '—') +
      card('Shareholders', fmt(d.shareholders, 0)) +
      '</div></div>';
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
          '<h2>Screener fundamentals loaded</h2><p>Price chart / technical verdict unavailable (Yahoo). Use valuation & Screener panels below.</p>';
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

    if (state.df) Charts.priceChart(state.df, state.showBollinger);
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
    const fcfEl = $('#dcf-fcf');
    const sharesEl = $('#dcf-shares');
    const gEl = $('#dcf-growth');
    const dEl = $('#dcf-discount');
    if (!epsEl) return;

    // Prefer Screener numbers
    if (d.trailingEps != null) epsEl.value = Number(d.trailingEps).toFixed(2);
    else if (info.trailingEps != null) epsEl.value = Number(info.trailingEps).toFixed(2);

    if (d.bookValue != null) bvEl.value = Number(d.bookValue).toFixed(2);
    else if (info.bookValue != null) bvEl.value = Number(info.bookValue).toFixed(2);

    if (d.freeCashflowCr != null) fcfEl.value = Number(d.freeCashflowCr).toFixed(2);
    if (d.sharesOutstandingCr != null) sharesEl.value = Number(d.sharesOutstandingCr).toFixed(2);

    // Growth default from Screener profit growth if available
    if (gEl && !gEl.dataset.set && d.profitGrowth && d.profitGrowth.y5 != null) {
      gEl.value = d.profitGrowth.y5;
      gEl.dataset.set = '1';
    }
    if (!gEl.value) gEl.value = 12;
    if (!dEl.value) dEl.value = 11;

    function updateGraham() {
      const eps = parseFloat(epsEl.value) || 0;
      const bv = parseFloat(bvEl.value) || 0;
      if (eps > 0 && bv > 0) {
        $('#graham-result').innerHTML =
          'Calculated Graham Value: <strong>' + formatINR(Math.sqrt(22.5 * eps * bv)) + '</strong>';
      } else $('#graham-result').textContent = 'Enter EPS and BVPS from Screener';
    }
    epsEl.oninput = bvEl.oninput = updateGraham;
    updateGraham();

    function updateDCF() {
      const fcf = parseFloat(fcfEl.value) || 0;
      const shares = parseFloat(sharesEl.value) || 1;
      const g = parseFloat(gEl.value) / 100;
      const disc = parseFloat(dEl.value) / 100;
      if (disc <= 0.045) {
        $('#dcf-result').textContent = 'Discount rate must be > 4.5%';
        return;
      }
      const pvs = [];
      for (let i = 1; i <= 5; i++) pvs.push((fcf * Math.pow(1 + g, i)) / Math.pow(1 + disc, i));
      const terminal = (pvs[4] * 1.045) / (disc - 0.045);
      const total = pvs.reduce((a, b) => a + b, 0) + terminal / Math.pow(1 + disc, 5);
      $('#dcf-result').innerHTML =
        'Calculated DCF Fair Value: <strong>' + formatINR(total / shares) + '</strong>';
    }
    [fcfEl, sharesEl, gEl, dEl].forEach((el) => {
      el.oninput = updateDCF;
    });
    updateDCF();

    const note = $('#fundamentals-note');
    if (note) {
      note.textContent = state.sheet
        ? 'Fundamentals: Screener via Google Sheet (live)'
        : 'Fundamentals: waiting for Screener sheet…';
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
    state.sheet = null;

    hide($('#main-content'));
    hide($('#error-box'));
    show($('#loading'));
    const loadMsg = $('#loading');
    if (loadMsg) loadMsg.innerHTML = '<div class="spinner"></div><div>Loading chart + Screener (sheet)…</div>';

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
            'Yahoo chart failed and Screener sheet returned no data. Check network / Sheets deploy.'
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
          'Price chart unavailable (Yahoo blocked). Screener fundamentals loaded — valuation still works.';
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
        if (state.df && state.view === 'market') if (state.df) Charts.priceChart(state.df, state.showBollinger);
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
