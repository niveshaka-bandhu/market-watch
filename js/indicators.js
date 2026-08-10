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

  return {
    calculateAll,
    pivots,
    sma,
    ema,
    rsi,
    macd,
    bollinger,
    atr
  };
})();
