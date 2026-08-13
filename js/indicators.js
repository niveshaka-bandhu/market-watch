/**
 * Technical indicator calculations
 */

const Indicators = (() => {
  function sma(series, period) {
    const out = new Array(series.length).fill(null);
    for (let i = period - 1; i < series.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += series[i - j];
      out[i] = sum / period;
    }
    return out;
  }

  function ema(series, period) {
    const out = new Array(series.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < series.length; i++) {
      if (series[i] == null) continue;
      if (prev === null) {
        // seed with SMA
        if (i >= period - 1) {
          let sum = 0;
          for (let j = 0; j < period; j++) sum += series[i - j];
          prev = sum / period;
          out[i] = prev;
        }
      } else {
        prev = series[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return out;
  }

  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    const macdLine = closes.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
    );
    const signalLine = ema(macdLine.map(v => v == null ? 0 : v), signal);
    // fix signal where macd was null
    for (let i = 0; i < signalLine.length; i++) {
      if (macdLine[i] == null) signalLine[i] = null;
    }
    const hist = macdLine.map((v, i) =>
      v != null && signalLine[i] != null ? v - signalLine[i] : null
    );
    return { macd: macdLine, signal: signalLine, hist };
  }

  function bollinger(closes, period = 20, mult = 2) {
    const mid = sma(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      let sumSq = 0;
      for (let j = 0; j < period; j++) {
        const d = closes[i - j] - mid[i];
        sumSq += d * d;
      }
      const std = Math.sqrt(sumSq / period);
      upper[i] = mid[i] + mult * std;
      lower[i] = mid[i] - mult * std;
    }
    return { mid, upper, lower };
  }

  function atr(highs, lows, closes, period = 14) {
    const tr = new Array(closes.length).fill(null);
    tr[0] = highs[0] - lows[0];
    for (let i = 1; i < closes.length; i++) {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      tr[i] = Math.max(hl, hc, lc);
    }
    return sma(tr, period);
  }

  function calculateAll(history) {
    if (!history || history.length < 30) {
      throw new Error('Not enough price history to calculate indicators');
    }
    const closes = history.map(r => r.close);
    const highs = history.map(r => r.high);
    const lows = history.map(r => r.low);

    const sma50 = sma(closes, Math.min(50, history.length - 1));
    const sma200 = sma(closes, Math.min(200, history.length - 1));
    const rsi14 = rsi(closes, 14);
    const macdData = macd(closes);
    const bb = bollinger(closes, 20, 2);
    const atr14 = atr(highs, lows, closes, 14);

    const dailyReturn = closes.map((c, i) =>
      i === 0 || !closes[i - 1] ? null : (c - closes[i - 1]) / closes[i - 1]
    );

    return history.map((row, i) => ({
      ...row,
      sma50: sma50[i],
      sma200: sma200[i],
      rsi: rsi14[i],
      macd: macdData.macd[i],
      signal: macdData.signal[i],
      macdHist: macdData.hist[i],
      bbMid: bb.mid[i],
      bbUpper: bb.upper[i],
      bbLower: bb.lower[i],
      atr: atr14[i],
      dailyReturn: dailyReturn[i]
    }));
  }

  // Classic pivot points from last candle
  function pivots(last) {
    if (!last) return { pivot: 0, r1: 0, r2: 0, s1: 0, s2: 0, atr: 0 };
    const h = last.high || last.close, l = last.low || last.close, c = last.close;
    const pivot = (h + l + c) / 3;
    return {
      pivot,
      r1: 2 * pivot - l,
      r2: pivot + (h - l),
      s1: 2 * pivot - h,
      s2: pivot - (h - l),
      atr: last.atr || (h - l)
    };
  }

  // Aggregate daily OHLCV rows into weekly or monthly candles for the chart
  // timeframe selector. 'D' returns the input unchanged. Recomputes SMA50/200
  // and Bollinger Bands on the aggregated closes so overlays stay meaningful
  // at the chosen granularity (RSI/MACD/verdict logic stays on daily data —
  // this is purely for the price chart's display).
  function weekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diffToMonday);
    return d.toISOString().slice(0, 10); // Monday of that week
  }
  function monthKey(dateStr) {
    return dateStr.slice(0, 7); // YYYY-MM
  }

  function aggregateOHLC(df, period) {
    if (!df || !df.length || period === 'D') return df;
    const keyFn = period === 'W' ? weekKey : monthKey;
    const buckets = [];
    const indexByKey = {};
    for (const row of df) {
      const key = keyFn(row.date);
      if (!(key in indexByKey)) {
        indexByKey[key] = buckets.length;
        buckets.push({
          date: row.date, // bucket start label; overwritten below to first row's date
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume || 0,
          _firstDate: row.date
        });
      } else {
        const b = buckets[indexByKey[key]];
        b.high = Math.max(b.high, row.high);
        b.low = Math.min(b.low, row.low);
        b.close = row.close;
        b.volume += row.volume || 0;
      }
    }
    const closes = buckets.map((b) => b.close);
    const sma50 = sma(closes, Math.min(50, closes.length - 1 || 1));
    const sma200 = sma(closes, Math.min(200, closes.length - 1 || 1));
    const bb = bollinger(closes, Math.min(20, closes.length - 1 || 1), 2);
    return buckets.map((b, i) => ({
      date: b._firstDate,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      sma50: sma50[i],
      sma200: sma200[i],
      bbMid: bb.mid[i],
      bbUpper: bb.upper[i],
      bbLower: bb.lower[i]
    }));
  }

  // ---------- Advanced analysis ----------

  const RISK_FREE_RATE = 0.07; // approx. Indian 10Y G-Sec, used for Sharpe

  function riskMetrics(df) {
    if (!df || df.length < 30) return null;
    const returns = df.map((r) => r.dailyReturn).filter((v) => v != null && !isNaN(v));
    if (returns.length < 20) return null;

    const n = returns.length;
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
    const dailyVol = Math.sqrt(variance);
    const annualVol = dailyVol * Math.sqrt(252);
    const annualReturn = Math.pow(1 + mean, 252) - 1;
    const sharpe = annualVol > 0 ? (annualReturn - RISK_FREE_RATE) / annualVol : null;

    // Max drawdown off the closing price series
    let peak = -Infinity;
    let maxDD = 0;
    for (const row of df) {
      if (row.close == null) continue;
      if (row.close > peak) peak = row.close;
      if (peak > 0) {
        const dd = (row.close - peak) / peak;
        if (dd < maxDD) maxDD = dd;
      }
    }

    const bestDay = Math.max(...returns);
    const worstDay = Math.min(...returns);

    return {
      annualReturn: annualReturn * 100,
      annualVol: annualVol * 100,
      sharpe,
      maxDrawdown: maxDD * 100,
      bestDay: bestDay * 100,
      worstDay: worstDay * 100
    };
  }

  function fibonacciLevels(df, lookback) {
    if (!df || !df.length) return null;
    const window = lookback ? df.slice(-lookback) : df;
    let hi = -Infinity;
    let lo = Infinity;
    for (const row of window) {
      if (row.high > hi) hi = row.high;
      if (row.low < lo) lo = row.low;
    }
    if (!isFinite(hi) || !isFinite(lo) || hi === lo) return null;
    const range = hi - lo;
    const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    return ratios.map((r) => ({
      ratio: r,
      price: hi - range * r,
      label: (r * 100).toFixed(1) + '%'
    }));
  }

  return {
    calculateAll,
    pivots,
    sma,
    ema,
    rsi,
    macd,
    bollinger,
    atr,
    aggregateOHLC,
    riskMetrics,
    fibonacciLevels
  };
})();
