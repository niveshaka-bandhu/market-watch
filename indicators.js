/**
 * Indian Quant Verdict – Main Application Controller
 */

const App = (() => {
  let state = {
    ticker: 'RELIANCE.NS',
    rawInput: 'RELIANCE',
    df: null,
    info: {},
    verdict: null,
    showBollinger: true,
    view: 'market'
  };

  // ---------- DOM Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function show(el) { el?.classList.remove('hidden'); }
  function hide(el) { el?.classList.add('hidden'); }

  function formatINR(n) {
    if (n == null || isNaN(n)) return '—';
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function formatPct(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return (n * 100).toFixed(digits) + '%';
  }

  // ---------- Render Market View ----------
  function renderMarketView() {
    const v = state.verdict;
    if (!v || !v.latest) return;
    const last = v.latest;
    const prev = v.prev || last;

    // Verdict box
    const box = $('#verdict-box');
    box.className = `verdict-box ${v.cssClass}`;
    box.innerHTML = `
      <h2>🔍 SYSTEM DISPATCH: ${v.master}</h2>
      <p><strong>Executive Summary:</strong> ${v.summary}</p>
    `;

    // Bull / Bear
    const bullUl = $('#bull-list');
    const bearUl = $('#bear-list');
    bullUl.innerHTML = v.bull.length
      ? v.bull.map(p => `<li>${p}</li>`).join('')
      : '<li>No distinct positive algorithmic signals triggered.</li>';
    bearUl.innerHTML = v.bear.length
      ? v.bear.map(p => `<li>${p}</li>`).join('')
      : '<li>No severe structural risk vectors flagged.</li>';

    // Metrics
    const change = last.close - prev.close;
    const pct = prev.close ? (change / prev.close) * 100 : 0;
    const livePx = (state.info && state.info.currentPrice != null) ? state.info.currentPrice : last.close;
    const basePx = (state.info && state.info.previousClose != null) ? state.info.previousClose : prev.close;
    const liveChg = livePx - basePx;
    const livePct = basePx ? (liveChg / basePx) * 100 : pct;
    $('#m-price').textContent = formatINR(livePx);
    $('#m-delta').textContent = `${liveChg >= 0 ? '+' : ''}${liveChg.toFixed(2)} (${livePct >= 0 ? '+' : ''}${livePct.toFixed(2)}%)`;
    $('#m-delta').className = `delta ${liveChg >= 0 ? 'positive' : 'negative'}`;
    $('#m-rsi').textContent = last.rsi != null ? last.rsi.toFixed(1) : '—';
    $('#m-macd').textContent = last.macdHist != null ? last.macdHist.toFixed(2) : '—';
    $('#m-bull').textContent = (v.bullRatio * 100).toFixed(1) + '%';

    // Chart
    Charts.priceChart(state.df, state.showBollinger);

    // Pivots
    const piv = Indicators.pivots(last);
    $('#pivot-r2').textContent = formatINR(piv.r2);
    $('#pivot-r1').textContent = formatINR(piv.r1);
    $('#pivot-central').textContent = formatINR(piv.pivot);
    $('#pivot-s1').textContent = formatINR(piv.s1);
    $('#pivot-s2').textContent = formatINR(piv.s2);
    $('#pivot-atr').textContent = formatINR(piv.atr);

    // Graham & simple DCF (interactive)
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

    // Graham: use live EPS / BVPS when available
    const epsVal = (info.trailingEps != null && info.trailingEps > 0) ? info.trailingEps : 55;
    const bvVal = (info.bookValue != null && info.bookValue > 0) ? info.bookValue : 668;
    epsEl.value = Number(epsVal).toFixed(2);
    bvEl.value = Number(bvVal).toFixed(2);

    function updateGraham() {
      const eps = parseFloat(epsEl.value) || 0;
      const bv = parseFloat(bvEl.value) || 0;
      if (eps > 0 && bv > 0) {
        const g = Math.sqrt(22.5 * eps * bv);
        $('#graham-result').innerHTML = 'Calculated Graham Value: <strong>' + formatINR(g) + '</strong>';
      } else {
        $('#graham-result').textContent = 'Enter positive EPS and BVPS';
      }
    }
    epsEl.oninput = bvEl.oninput = updateGraham;
    updateGraham();

    // DCF inputs in ₹ Crores
    // Yahoo freeCashflow & sharesOutstanding are absolute INR / share count
    let fcfCr;
    if (info.freeCashflow != null && !isNaN(info.freeCashflow) && info.freeCashflow !== 0) {
      fcfCr = info.freeCashflow / 1e7; // absolute → crores
    } else {
      fcfCr = 50000; // realistic placeholder for large-cap India (edit me)
    }

    let shCr;
    if (info.sharesOutstanding != null && info.sharesOutstanding > 0) {
      shCr = info.sharesOutstanding / 1e7; // shares → crore shares
    } else if (info.marketCap != null && last && last.close) {
      shCr = (info.marketCap / last.close) / 1e7;
    } else if (last && last.close > 500) {
      // large-cap heuristic from price band (Reliance-class ~1350 Cr shares)
      shCr = 1350;
    } else {
      shCr = 100;
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
      const fair = total / shares;
      $('#dcf-result').innerHTML = 'Calculated DCF Fair Value: <strong>' + formatINR(fair) + '</strong>';
    }
    [fcfEl, sharesEl, gEl, dEl].forEach(el => el.oninput = updateDCF);
    updateDCF();

    // Status note
    const note = document.getElementById('fundamentals-note');
    if (note) {
      if (info.fundamentalsLive) {
        note.textContent = 'Fundamentals: live from Yahoo Finance';
        note.style.color = 'var(--green)';
      } else {
        note.textContent = 'Fundamentals: Yahoo locked (crumb). EPS/BV/FCF are editable estimates — update from Yahoo Finance page.';
        note.style.color = 'var(--yellow)';
      }
    }
  }

  function renderQuantView() {
    const info = state.info || {};
    const fmtNum = (v, d=2) => (v != null && !isNaN(v)) ? Number(v).toFixed(d) : '—';
    const fmtPct = (v) => (v != null && !isNaN(v)) ? (v * 100).toFixed(2) + '%' : '—';
    // Yahoo debtToEquity is already a ratio*100 style number sometimes; show as-is /100 if > 5
    let de = info.debtToEquity;
    let deDisp = '—';
    if (de != null && !isNaN(de)) {
      deDisp = de > 5 ? (de / 100).toFixed(2) : Number(de).toFixed(2);
    }
    const rows = [
      ['Return on Equity (ROE)', fmtPct(info.returnOnEquity), '> 15% Optimal'],
      ['Return on Assets (ROA)', fmtPct(info.returnOnAssets), '> 8% Optimal'],
      ['Operating Margin', fmtPct(info.operatingMargins), '> 12% High Efficiency'],
      ['Profit Margin', fmtPct(info.profitMargins), '—'],
      ['Debt-to-Equity', deDisp, '< 1.0 Low Leverage'],
      ['Current Ratio', fmtNum(info.currentRatio), '> 1.2 Sound'],
      ['Beta', fmtNum(info.beta), '< 1.0 Defensive'],
      ['Trailing P/E', fmtNum(info.trailingPE), '—'],
      ['P/B', fmtNum(info.priceToBook), '—'],
      ['PEG', fmtNum(info.pegRatio), '< 1.5 Value Growth'],
      ['Dividend Yield', fmtPct(info.dividendYield), '—'],
      ['Market Cap', info.marketCap != null ? formatINR(info.marketCap) : '—', '—']
    ];
    $('#quality-body').innerHTML = rows.map(r =>
      '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'
    ).join('');

    // Shareholding
    const ins = info.heldPercentInsiders;
    const inst = info.heldPercentInstitutions;
    const insPct = ins != null ? (ins * 100).toFixed(2) + '%' : '—';
    const instPct = inst != null ? (inst * 100).toFixed(2) + '%' : '—';
    let publicPct = '—';
    if (ins != null && inst != null) {
      publicPct = Math.max(0, 100 - ins * 100 - inst * 100).toFixed(2) + '%';
    }
    const shEl = document.getElementById('shareholding-row');
    if (shEl) {
      shEl.innerHTML =
        '<div class="metric-card"><div class="label">Promoter / Insider</div><div class="value" style="font-size:16px">' + insPct + '</div></div>' +
        '<div class="metric-card"><div class="label">Institutions (FII/DII)</div><div class="value" style="font-size:16px">' + instPct + '</div></div>' +
        '<div class="metric-card"><div class="label">Public Float (est.)</div><div class="value" style="font-size:16px">' + publicPct + '</div></div>';
    }

    runMonteCarlo();
    $('#run-backtest').onclick = runBacktest;
  }

  function runMonteCarlo() {
    const df = state.df;
    const last = df[df.length - 1];
    const returns = df.map(r => r.dailyReturn).filter(v => v != null);
    let vol = 0.015;
    if (returns.length > 10) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      vol = Math.sqrt(variance) || 0.015;
    }

    const days = 30;
    const sims = 150;
    const matrix = Array.from({ length: days }, () => new Array(sims));
    for (let s = 0; s < sims; s++) matrix[0][s] = last.close;

    for (let d = 1; d < days; d++) {
      for (let s = 0; s < sims; s++) {
        const shock = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * vol; // approx normal
        matrix[d][s] = matrix[d - 1][s] * Math.exp(shock);
      }
    }

    Charts.monteCarloChart(matrix);

    const final = matrix[days - 1].slice().sort((a, b) => a - b);
    const p10 = final[Math.floor(sims * 0.1)];
    const p50 = final[Math.floor(sims * 0.5)];
    const p90 = final[Math.floor(sims * 0.9)];
    $('#mc-stats').innerHTML = `
      <li><strong>10th Percentile (Downside):</strong> ${formatINR(p10)}</li>
      <li><strong>50th Percentile (Median):</strong> ${formatINR(p50)}</li>
      <li><strong>90th Percentile (Upside):</strong> ${formatINR(p90)}</li>
    `;
  }

  function runBacktest() {
    const strategy = $('#bt-strategy').value;
    const capital = parseFloat($('#bt-capital').value) || 100000;
    const df = (state.df || []).filter(r =>
      strategy === 'sma' ? (r.sma50 != null && r.sma200 != null) : (r.macd != null && r.signal != null)
    );

    if (df.length < 10) {
      $('#bt-result').textContent = 'Insufficient data for backtest.';
      return;
    }

    let pos = 0, cash = capital, shares = 0;
    const equity = [];
    const dates = [];

    for (const row of df) {
      const buySignal = strategy === 'sma'
        ? row.sma50 > row.sma200
        : row.macd > row.signal;

      if (pos === 0 && buySignal) {
        shares = cash / row.close;
        cash = 0;
        pos = 1;
      } else if (pos === 1 && !buySignal) {
        cash = shares * row.close;
        shares = 0;
        pos = 0;
      }
      equity.push(cash + shares * row.close);
      dates.push(row.date);
    }

    const firstClose = df[0].close;
    const buyHold = df.map(r => (capital / firstClose) * r.close);

    Charts.backtestChart(dates, equity, buyHold);
    const finalVal = equity[equity.length - 1];
    $('#bt-result').innerHTML = `Strategy Terminal Worth: <strong>${formatINR(finalVal)}</strong>`;
  }

  // ---------- Main Load ----------
  async function loadTicker() {
    const raw = $('#ticker-input').value.trim().toUpperCase();
    if (!raw) return;

    state.rawInput = raw;
    state.ticker = DataService.normalizeTicker(raw);
    state.showBollinger = $('#show-bb').checked;

    hide($('#main-content'));
    hide($('#error-box'));
    show($('#loading'));

    try {
      const { history, info } = await DataService.loadAll(state.ticker);
      state.df = Indicators.calculateAll(history);
      state.info = info;
      state.verdict = VerdictEngine.analyse(state.df, state.info);

      hide($('#loading'));
      show($('#main-content'));

      // Title
      $('#asset-title').textContent = `Strategic Asset Intelligence Center (${state.rawInput})`;

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
      box.textContent = `Unable to load data for ${state.ticker}. ${err.message || err}. Try another ticker (e.g. TCS, INFY, HDFCBANK, SBIN).`;
      show(box);
    }
  }

  // ---------- Event Binding ----------
  function init() {
    // View switch
    $$('input[name="workspace"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.view = e.target.value;
        if (state.df) {
          if (state.view === 'market') {
            show($('#view-market'));
            hide($('#view-quant'));
            renderMarketView();
          } else {
            hide($('#view-market'));
            show($('#view-quant'));
            renderQuantView();
          }
        }
      });
    });

    $('#show-bb').addEventListener('change', () => {
      state.showBollinger = $('#show-bb').checked;
      if (state.df && state.view === 'market') Charts.priceChart(state.df, state.showBollinger);
    });

    $('#ticker-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadTicker();
    });
    $('#analyse-btn').addEventListener('click', loadTicker);

    // Tabs inside quant view
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach(b => b.classList.remove('active'));
        $$('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        $(`#tab-${btn.dataset.tab}`).classList.add('active');
      });
    });

    // Service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Initial load
    loadTicker();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
