// ========== PASTE YOUR APPS SCRIPT WEB APP URL HERE ==========
const SHEETS_API = 'https://script.google.com/macros/s/AKfycbwyno4ZTdWUDp46qBQfIC4Pe4iD9xc8-Q3-v_0PCrZyFwc-SzFay2sidBnVeojibPcV/exec';
// ============================================================

const App = (() => {
  let state = {
    ticker: 'RELIANCE.NS',
    rawInput: 'RELIANCE',
    df: null,
    info: {},
    verdict: null,
    showBollinger: true,
    view: 'market',
    sheetData: null
  };

  let equityIndex = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  function show(el) { el?.classList.remove('hidden'); }
  function hide(el) { el?.classList.add('hidden'); }

  function formatINR(n) {
    if (n == null || isNaN(n)) return '—';
    return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  // ----- Google Sheets (JSONP – works from GitHub Pages) -----
  function sheetsJsonp(params) {
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const q = Object.keys(params)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');
      const s = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('Sheets timeout')); }, 30000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) {}
        s.remove();
      }
      window[cb] = (data) => { cleanup(); resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error('Sheets network error')); };
      s.src = SHEETS_API + '?' + q + '&callback=' + cb;
      document.body.appendChild(s);
    });
  }

  async function loadEquityList() {
    try {
      const res = await sheetsJsonp({ action: 'equity' });
      if (res && res.ok) equityIndex = res.data || [];
    } catch (e) {
      console.warn('Equity list failed', e);
      equityIndex = [];
    }
  }

  function setupSearch() {
    const input = $('#ticker-input');
    if (!input) return;
    let box = $('#search-suggest');
    if (!box) {
      box = document.createElement('div');
      box.id = 'search-suggest';
      box.style.cssText =
        'position:absolute;z-index:50;background:#1a222d;border:1px solid #2a3441;' +
        'border-radius:8px;max-height:240px;overflow:auto;display:none;width:min(360px,90vw);left:0;top:100%';
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(box);
    }
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) { box.style.display = 'none'; return; }
      const hits = equityIndex
        .filter(x =>
          (x.symbol || '').toLowerCase().includes(q) ||
          (x.name || '').toLowerCase().includes(q)
        )
        .slice(0, 12);
      if (!hits.length) { box.style.display = 'none'; return; }
      box.innerHTML = hits.map(h =>
        `<div data-sym="${h.symbol}" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #2a3441">
          <b>${h.symbol}</b> <span style="color:#8b9aab">${h.name || ''}</span>
        </div>`
      ).join('');
      box.style.display = 'block';
      box.querySelectorAll('[data-sym]').forEach(el => {
        el.onclick = () => {
          input.value = el.getAttribute('data-sym');
          box.style.display = 'none';
        };
      });
    });
    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && e.target !== input) box.style.display = 'none';
    });
  }

  async function loadFromSheets(ticker) {
    const res = await sheetsJsonp({ action: 'analyse', ticker: ticker });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Sheets analyse failed');
    return res.data;
  }

  function applySheetFundamentals(d) {
    if (!d) return;
    state.sheetData = d;
    state.info = state.info || {};
    state.info.fundamentalsLive = true;
    state.info.trailingEps = d.trailingEps;
    state.info.bookValue = d.bookValue;
    state.info.freeCashflow = d.freeCashflowCr != null ? d.freeCashflowCr * 1e7 : null;
    state.info.sharesOutstanding = d.sharesOutstandingCr != null ? d.sharesOutstandingCr * 1e7 : null;
    state.info.returnOnEquity = d.roeLast != null ? d.roeLast / 100 : (d.roe10y != null ? d.roe10y / 100 : null);
    state.info.operatingMargins = d.opmTtm != null ? (d.opmTtm > 1 ? d.opmTtm / 100 : d.opmTtm) : null;
    state.info.heldPercentInsiders = d.promoters != null ? d.promoters / 100 : null;
    if (d.fiis != null || d.diis != null) {
      state.info.heldPercentInstitutions = ((d.fiis || 0) + (d.diis || 0)) / 100;
    }

    const epsEl = $('#graham-eps');
    const bvEl = $('#graham-bvps');
    const fcfEl = $('#dcf-fcf');
    const shEl = $('#dcf-shares');
    if (epsEl && d.trailingEps != null) epsEl.value = d.trailingEps;
    if (bvEl && d.bookValue != null) bvEl.value = Number(d.bookValue).toFixed(2);
    if (fcfEl && d.freeCashflowCr != null) fcfEl.value = d.freeCashflowCr;
    if (shEl && d.sharesOutstandingCr != null) shEl.value = Number(d.sharesOutstandingCr).toFixed(2);

    showSheetPanels(d);
  }

  function showSheetPanels(d) {
    let host = $('#sheet-fundamentals');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sheet-fundamentals';
      host.className = 'card';
      host.style.marginTop = '16px';
      const main = $('#view-market') || $('#main-content');
      if (main) main.appendChild(host);
    }
    host.innerHTML =
      '<h3>📄 Screener fundamentals (' + (d.ticker || '') + ')</h3>' +
      '<div class="two-col">' +
      '<div><strong>Pros</strong><ul class="bull-list">' +
      ((d.pros || []).map(p => '<li>' + p + '</li>').join('') || '<li>—</li>') +
      '</ul></div>' +
      '<div><strong>Cons</strong><ul class="bear-list">' +
      ((d.cons || []).map(c => '<li>' + c + '</li>').join('') || '<li>—</li>') +
      '</ul></div></div>' +
      '<div class="metrics-row" style="margin-top:12px">' +
      '<div class="metric-card"><div class="label">TTM EPS</div><div class="value">' + (d.trailingEps ?? '—') + '</div></div>' +
      '<div class="metric-card"><div class="label">FCF (₹ Cr)</div><div class="value">' + (d.freeCashflowCr ?? '—') + '</div></div>' +
      '<div class="metric-card"><div class="label">ROE (Last Yr)</div><div class="value">' + (d.roeLast ?? '—') + '%</div></div>' +
      '<div class="metric-card"><div class="label">Promoters</div><div class="value">' + (d.promoters ?? '—') + '%</div></div>' +
      '</div>';
  }

  // ----- Render market view -----
  function renderMarketView() {
    const v = state.verdict;
    if (!v || !v.latest) return;
    const last = v.latest;
    const prev = v.prev || last;

    const box = $('#verdict-box');
    box.className = 'verdict-box ' + v.cssClass;
    box.innerHTML =
      '<h2>🔍 SYSTEM DISPATCH: ' + v.master + '</h2>' +
      '<p><strong>Executive Summary:</strong> ' + v.summary + '</p>';

    $('#bull-list').innerHTML = v.bull.length
      ? v.bull.map(p => '<li>' + p + '</li>').join('')
      : '<li>No distinct positive signals.</li>';
    $('#bear-list').innerHTML = v.bear.length
      ? v.bear.map(p => '<li>' + p + '</li>').join('')
      : '<li>No severe risk vectors.</li>';

    const livePx = (state.info && state.info.currentPrice != null) ? state.info.currentPrice : last.close;
    const basePx = (state.info && state.info.previousClose != null) ? state.info.previousClose : prev.close;
    const liveChg = livePx - basePx;
    const livePct = basePx ? (liveChg / basePx) * 100 : 0;
    $('#m-price').textContent = formatINR(livePx);
    $('#m-delta').textContent =
      (liveChg >= 0 ? '+' : '') + liveChg.toFixed(2) +
      ' (' + (livePct >= 0 ? '+' : '') + livePct.toFixed(2) + '%)';
    $('#m-delta').className = 'delta ' + (liveChg >= 0 ? 'positive' : 'negative');
    $('#m-rsi').textContent = last.rsi != null ? last.rsi.toFixed(1) : '—';
    $('#m-macd').textContent = last.macdHist != null ? last.macdHist.toFixed(2) : '—';
    $('#m-bull').textContent = (v.bullRatio * 100).toFixed(1) + '%';

    Charts.priceChart(state.df, state.showBollinger);

    const piv = Indicators.pivots(last);
    $('#pivot-r2').textContent = formatINR(piv.r2);
    $('#pivot-r1').textContent = formatINR(piv.r1);
    $('#pivot-central').textContent = formatINR(piv.pivot);
    $('#pivot-s1').textContent = formatINR(piv.s1);
    $('#pivot-s2').textContent = formatINR(piv.s2);
    $('#pivot-atr').textContent = formatINR(piv.atr);

    renderValuationWidgets(last);
  }

  function renderValuationWidgets(last) {
    const info = state.info || {};
    const epsEl = $('#graham-eps');
    const bvEl = $('#graham-bvps');
    const fcfEl = $('#dcf-fcf');
    const sharesEl = $('#dcf-shares');
    const gEl = $('#dcf-growth');
    const dEl = $('#dcf-discount');
    if (!epsEl) return;

    if (info.trailingEps != null && info.trailingEps > 0) epsEl.value = Number(info.trailingEps).toFixed(2);
    if (info.bookValue != null && info.bookValue > 0) bvEl.value = Number(info.bookValue).toFixed(2);

    function updateGraham() {
      const eps = parseFloat(epsEl.value) || 0;
      const bv = parseFloat(bvEl.value) || 0;
      if (eps > 0 && bv > 0) {
        $('#graham-result').innerHTML =
          'Calculated Graham Value: <strong>' + formatINR(Math.sqrt(22.5 * eps * bv)) + '</strong>';
      } else {
        $('#graham-result').textContent = 'Enter positive EPS and BVPS';
      }
    }
    epsEl.oninput = bvEl.oninput = updateGraham;
    updateGraham();

    let fcfCr = 50000;
    if (info.freeCashflow != null && !isNaN(info.freeCashflow) && info.freeCashflow !== 0) {
      fcfCr = info.freeCashflow / 1e7;
    }
    let shCr = 100;
    if (info.sharesOutstanding != null && info.sharesOutstanding > 0) {
      shCr = info.sharesOutstanding / 1e7;
    } else if (last && last.close > 500) {
      shCr = 1350;
    }
    fcfEl.value = Number(fcfCr).toFixed(2);
    sharesEl.value = Number(shCr).toFixed(2);
    if (!gEl.value) gEl.value = 12;
    if (!dEl.value) dEl.value = 11;

    function updateDCF() {
      const fcf = parseFloat(fcfEl.value) || 0;
      const shares = parseFloat(sharesEl.value) || 1;
      const g = parseFloat(gEl.value) / 100;
      const d = parseFloat(dEl.value) / 100;
      if (d <= 0.045) {
        $('#dcf-result').textContent = 'Discount rate must be > 4.5%';
        return;
      }
      const pvs = [];
      for (let i = 1; i <= 5; i++) {
        pvs.push(fcf * Math.pow(1 + g, i) / Math.pow(1 + d, i));
      }
      const terminal = (pvs[4] * 1.045) / (d - 0.045);
      const total = pvs.reduce((a, b) => a + b, 0) + terminal / Math.pow(1 + d, 5);
      $('#dcf-result').innerHTML =
        'Calculated DCF Fair Value: <strong>' + formatINR(total / shares) + '</strong>';
    }
    [fcfEl, sharesEl, gEl, dEl].forEach(el => { el.oninput = updateDCF; });
    updateDCF();

    const note = $('#fundamentals-note');
    if (note) {
      if (info.fundamentalsLive) {
        note.textContent = 'Fundamentals: from Google Sheet / Screener';
        note.style.color = 'var(--green)';
      } else {
        note.textContent = 'Fundamentals: estimates — edit EPS / BV / FCF or connect Sheets';
        note.style.color = 'var(--yellow)';
      }
    }
  }

  function renderQuantView() {
    const info = state.info || {};
    const fmtNum = (v, d) => (v != null && !isNaN(v)) ? Number(v).toFixed(d == null ? 2 : d) : '—';
    const fmtPct = (v) => (v != null && !isNaN(v)) ? (v * 100).toFixed(2) + '%' : '—';
    let de = info.debtToEquity;
    let deDisp = '—';
    if (de != null && !isNaN(de)) deDisp = de > 5 ? (de / 100).toFixed(2) : Number(de).toFixed(2);

    const rows = [
      ['Return on Equity (ROE)', fmtPct(info.returnOnEquity), '> 15% Optimal'],
      ['Operating Margin', fmtPct(info.operatingMargins), '> 12% High Efficiency'],
      ['Debt-to-Equity', deDisp, '< 1.0 Low Leverage'],
      ['Trailing P/E', fmtNum(info.trailingPE), '—'],
      ['P/B', fmtNum(info.priceToBook), '—'],
      ['Market Cap', info.marketCap != null ? formatINR(info.marketCap) : '—', '—']
    ];
    const body = $('#quality-body');
    if (body) {
      body.innerHTML = rows.map(r =>
        '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'
      ).join('');
    }

    const ins = info.heldPercentInsiders;
    const inst = info.heldPercentInstitutions;
    const shEl = $('#shareholding-row');
    if (shEl) {
      const insPct = ins != null ? (ins * 100).toFixed(2) + '%' : '—';
      const instPct = inst != null ? (inst * 100).toFixed(2) + '%' : '—';
      let publicPct = '—';
      if (ins != null && inst != null) {
        publicPct = Math.max(0, 100 - ins * 100 - inst * 100).toFixed(2) + '%';
      }
      shEl.innerHTML =
        '<div class="metric-card"><div class="label">Promoter / Insider</div><div class="value" style="font-size:16px">' + insPct + '</div></div>' +
        '<div class="metric-card"><div class="label">Institutions</div><div class="value" style="font-size:16px">' + instPct + '</div></div>' +
        '<div class="metric-card"><div class="label">Public (est.)</div><div class="value" style="font-size:16px">' + publicPct + '</div></div>';
    }

    runMonteCarlo();
    const btn = $('#run-backtest');
    if (btn) btn.onclick = runBacktest;
  }

  function runMonteCarlo() {
    const df = state.df;
    if (!df || !df.length) return;
    const last = df[df.length - 1];
    const returns = df.map(r => r.dailyReturn).filter(v => v != null);
    let vol = 0.015;
    if (returns.length > 10) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      vol = Math.sqrt(variance) || 0.015;
    }
    const days = 30, sims = 120;
    const matrix = Array.from({ length: days }, () => new Array(sims));
    for (let s = 0; s < sims; s++) matrix[0][s] = last.close;
    for (let d = 1; d < days; d++) {
      for (let s = 0; s < sims; s++) {
        const shock = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * vol;
        matrix[d][s] = matrix[d - 1][s] * Math.exp(shock);
      }
    }
    Charts.monteCarloChart(matrix);
    const final = matrix[days - 1].slice().sort((a, b) => a - b);
    const el = $('#mc-stats');
    if (el) {
      el.innerHTML =
        '<li><strong>10th %:</strong> ' + formatINR(final[Math.floor(sims * 0.1)]) + '</li>' +
        '<li><strong>Median:</strong> ' + formatINR(final[Math.floor(sims * 0.5)]) + '</li>' +
        '<li><strong>90th %:</strong> ' + formatINR(final[Math.floor(sims * 0.9)]) + '</li>';
    }
  }

  function runBacktest() {
    const strategy = $('#bt-strategy').value;
    const capital = parseFloat($('#bt-capital').value) || 100000;
    const df = (state.df || []).filter(r =>
      strategy === 'sma' ? (r.sma50 != null && r.sma200 != null) : (r.macd != null && r.signal != null)
    );
    if (df.length < 10) {
      $('#bt-result').textContent = 'Insufficient data';
      return;
    }
    let pos = 0, cash = capital, shares = 0;
    const equity = [], dates = [];
    for (const row of df) {
      const buy = strategy === 'sma' ? row.sma50 > row.sma200 : row.macd > row.signal;
      if (pos === 0 && buy) { shares = cash / row.close; cash = 0; pos = 1; }
      else if (pos === 1 && !buy) { cash = shares * row.close; shares = 0; pos = 0; }
      equity.push(cash + shares * row.close);
      dates.push(row.date);
    }
    const first = df[0].close;
    const buyHold = df.map(r => (capital / first) * r.close);
    Charts.backtestChart(dates, equity, buyHold);
    $('#bt-result').innerHTML =
      'Strategy Terminal Worth: <strong>' + formatINR(equity[equity.length - 1]) + '</strong>';
  }

  // ----- Main load -----
  async function loadTicker() {
    const raw = ($('#ticker-input').value || '').trim().toUpperCase();
    if (!raw) return;

    state.rawInput = raw;
    state.ticker = DataService.normalizeTicker(raw);
    state.showBollinger = $('#show-bb').checked;

    hide($('#main-content'));
    hide($('#error-box'));
    show($('#loading'));

    try {
      // 1) Price chart from Yahoo (fast)
      const { history, info, meta } = await DataService.loadAll(state.ticker);
      state.df = Indicators.calculateAll(history);
      state.info = info;

      // 2) Fundamentals from Google Sheet / Screener
      try {
        const sheetData = await loadFromSheets(raw);
        applySheetFundamentals(sheetData);
      } catch (sheetErr) {
        console.warn('Sheets skipped:', sheetErr);
      }

      state.verdict = VerdictEngine.analyse(state.df, state.info);

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
    } catch (err) {
      console.error(err);
      hide($('#loading'));
      const box = $('#error-box');
      box.textContent = 'Unable to load ' + state.ticker + '. ' + (err.message || err);
      show(box);
    }
  }

  function init() {
    $$('input[name="workspace"]').forEach(radio => {
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
    if (bb) {
      bb.addEventListener('change', () => {
        state.showBollinger = bb.checked;
        if (state.df && state.view === 'market') Charts.priceChart(state.df, state.showBollinger);
      });
    }

    const input = $('#ticker-input');
    if (input) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTicker(); });
    }
    const btn = $('#analyse-btn');
    if (btn) btn.addEventListener('click', loadTicker);

    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = $('#tab-' + btn.dataset.tab);
        if (tab) tab.classList.add('active');
      });
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    loadEquityList().then(setupSearch);
    loadTicker();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
