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

  function ichimoku(df) {
    if (!df || df.length < 52) return null;
    const highs = df.map((r) => r.high);
    const lows = df.map((r) => r.low);
    const closes = df.map((r) => r.close);
    const n = closes.length;

    function periodMid(period, i) {
      if (i < period - 1) return null;
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = 0; j < period; j++) {
        hh = Math.max(hh, highs[i - j]);
        ll = Math.min(ll, lows[i - j]);
      }
      return (hh + ll) / 2;
    }

    const tenkan = [];
    const kijun = [];
    const senkouA = [];
    const senkouB = [];
    for (let i = 0; i < n; i++) {
      const t = periodMid(9, i);
      const k = periodMid(26, i);
      tenkan.push(t);
      kijun.push(k);
      senkouA.push(t != null && k != null ? (t + k) / 2 : null);
      senkouB.push(periodMid(52, i));
    }
    // Chikou (lagging span): close plotted 26 periods behind where it actually
    // happened — i.e. chikou[i] = close[i+26], which naturally fits within
    // the existing date range (no chart-side date extension needed, unlike
    // the Senkou spans which project forward).
    const chikou = closes.map((_, i) => (i + 26 < n ? closes[i + 26] : null));

    return { tenkan, kijun, senkouA, senkouB, chikou };
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

  function stochastic(highs, lows, closes, period = 14, smoothK = 3, smoothD = 3) {
    const rawK = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = 0; j < period; j++) {
        hh = Math.max(hh, highs[i - j]);
        ll = Math.min(ll, lows[i - j]);
      }
      rawK[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    }
    const k = sma(rawK.map((v) => (v == null ? 0 : v)), smoothK);
    for (let i = 0; i < k.length; i++) if (rawK[i] == null) k[i] = null;
    const d = sma(k.map((v) => (v == null ? 0 : v)), smoothD);
    for (let i = 0; i < d.length; i++) if (k[i] == null) d[i] = null;
    return { k, d };
  }

  function williamsR(highs, lows, closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = 0; j < period; j++) {
        hh = Math.max(hh, highs[i - j]);
        ll = Math.min(ll, lows[i - j]);
      }
      out[i] = hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100;
    }
    return out;
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
    const stoch = stochastic(highs, lows, closes, 14, 3, 3);
    const willR = williamsR(highs, lows, closes, 14);

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
      stochK: stoch.k[i],
      stochD: stoch.d[i],
      williamsR: willR[i],
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

  // ---------- Candlestick patterns ----------

  function detectCandlestickPatterns(df) {
    if (!df || df.length < 3) return [];
    const c0 = df[df.length - 1]; // most recent (completed) candle
    const c1 = df[df.length - 2];
    const c2 = df[df.length - 3];
    if (!c0 || !c1 || !c2) return [];

    const bodySize = (c) => Math.abs(c.close - c.open);
    const candleRange = (c) => Math.max(c.high - c.low, 0.0001);
    const isBullish = (c) => c.close > c.open;
    const isBearish = (c) => c.close < c.open;
    const upperWick = (c) => c.high - Math.max(c.open, c.close);
    const lowerWick = (c) => Math.min(c.open, c.close) - c.low;

    const r0 = candleRange(c0);
    const b0 = bodySize(c0);
    const b1 = bodySize(c1);
    const b2 = bodySize(c2);
    const patterns = [];

    if (b0 / r0 < 0.1) {
      patterns.push({
        name: 'Doji',
        signal: 'neutral',
        note: 'Open ≈ close — indecision, often precedes a pause or reversal.'
      });
    }

    if (lowerWick(c0) >= 2 * b0 && upperWick(c0) <= b0 * 0.3 && b0 / r0 < 0.4) {
      patterns.push({
        name: 'Hammer',
        signal: 'bullish',
        note: 'Long lower wick, small body near the top — potential bullish reversal, especially after a decline.'
      });
    }

    if (upperWick(c0) >= 2 * b0 && lowerWick(c0) <= b0 * 0.3 && b0 / r0 < 0.4) {
      patterns.push({
        name: 'Shooting Star',
        signal: 'bearish',
        note: 'Long upper wick, small body near the bottom — potential bearish reversal, especially after a rally.'
      });
    }

    if (isBearish(c1) && isBullish(c0) && c0.open <= c1.close && c0.close >= c1.open) {
      patterns.push({
        name: 'Bullish Engulfing',
        signal: 'bullish',
        note: "Latest candle's body fully engulfs the prior red candle — buyers took control."
      });
    }

    if (isBullish(c1) && isBearish(c0) && c0.open >= c1.close && c0.close <= c1.open) {
      patterns.push({
        name: 'Bearish Engulfing',
        signal: 'bearish',
        note: "Latest candle's body fully engulfs the prior green candle — sellers took control."
      });
    }

    if (
      b0 < b1 * 0.6 &&
      Math.max(c0.open, c0.close) <= Math.max(c1.open, c1.close) &&
      Math.min(c0.open, c0.close) >= Math.min(c1.open, c1.close) &&
      ((isBullish(c1) && isBearish(c0)) || (isBearish(c1) && isBullish(c0)))
    ) {
      patterns.push({
        name: 'Harami',
        signal: 'neutral',
        note: "Small body contained within the prior candle's larger body — momentum stalling."
      });
    }

    if (
      isBearish(c2) &&
      b1 / candleRange(c1) < 0.4 &&
      isBullish(c0) &&
      c0.close > (c2.open + c2.close) / 2
    ) {
      patterns.push({
        name: 'Morning Star',
        signal: 'bullish',
        note: '3-candle bullish reversal: sharp decline, an indecisive pause, then a strong recovery.'
      });
    }

    if (
      isBullish(c2) &&
      b1 / candleRange(c1) < 0.4 &&
      isBearish(c0) &&
      c0.close < (c2.open + c2.close) / 2
    ) {
      patterns.push({
        name: 'Evening Star',
        signal: 'bearish',
        note: '3-candle bearish reversal: sharp rally, an indecisive pause, then a strong drop.'
      });
    }

    if (
      b0 / r0 > 0.85 &&
      upperWick(c0) <= r0 * 0.05 &&
      lowerWick(c0) <= r0 * 0.05
    ) {
      patterns.push({
        name: isBullish(c0) ? 'Bullish Marubozu' : 'Bearish Marubozu',
        signal: isBullish(c0) ? 'bullish' : 'bearish',
        note: 'Almost no wicks, full-body candle — one side was in control the entire session, strong momentum.'
      });
    }

    if (b0 / r0 < 0.3 && upperWick(c0) > b0 * 0.8 && lowerWick(c0) > b0 * 0.8) {
      patterns.push({
        name: 'Spinning Top',
        signal: 'neutral',
        note: 'Small body with wicks on both sides — a tug-of-war between buyers and sellers, momentum may be fading.'
      });
    }

    return patterns;
  }

  // Checks whether the latest close has broken above/below its recent
  // consolidation range, optionally confirmed by above-average volume —
  // classic breakout/breakdown read, computed purely from OHLCV.
  function detectBreakout(df, lookback) {
    lookback = lookback || 20;
    if (!df || df.length < lookback + 5) return null;
    const window = df.slice(-(lookback + 1), -1); // exclude the latest candle itself
    const last = df[df.length - 1];
    if (!window.length || last.close == null) return null;

    const rangeHigh = Math.max(...window.map((r) => r.high));
    const rangeLow = Math.min(...window.map((r) => r.low));
    const avgVolume = window.reduce((a, r) => a + (r.volume || 0), 0) / window.length;
    const volConfirmed = last.volume != null && avgVolume > 0 && last.volume > avgVolume * 1.5;

    if (last.close > rangeHigh) {
      return {
        type: 'breakout',
        level: rangeHigh,
        volConfirmed,
        note:
          `Closed above the ${lookback}-day consolidation high (₹${rangeHigh.toFixed(1)})` +
          (volConfirmed ? ', confirmed by volume well above average.' : ', but on unremarkable volume — watch for confirmation.')
      };
    }
    if (last.close < rangeLow) {
      return {
        type: 'breakdown',
        level: rangeLow,
        volConfirmed,
        note:
          `Closed below the ${lookback}-day consolidation low (₹${rangeLow.toFixed(1)})` +
          (volConfirmed ? ', confirmed by volume well above average.' : ', but on unremarkable volume — watch for confirmation.')
      };
    }
    return null;
  }



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

  function week52Range(df) {
    if (!df || !df.length) return null;
    const window = df.slice(-252); // ~1 trading year
    let hi = -Infinity;
    let lo = Infinity;
    for (const row of window) {
      if (row.high > hi) hi = row.high;
      if (row.low < lo) lo = row.low;
    }
    const last = df[df.length - 1];
    if (!isFinite(hi) || !isFinite(lo) || last.close == null) return null;
    return {
      high: hi,
      low: lo,
      current: last.close,
      pctFromHigh: ((last.close - hi) / hi) * 100,
      pctFromLow: ((last.close - lo) / lo) * 100
    };
  }

  function volatilityRange(riskMetrics, currentPrice, tradingDays) {
    if (!riskMetrics || currentPrice == null || riskMetrics.annualVol == null) return null;
    const dailyVol = riskMetrics.annualVol / 100 / Math.sqrt(252);
    const periodVol = dailyVol * Math.sqrt(tradingDays);
    return {
      upper: currentPrice * (1 + periodVol),
      lower: currentPrice * (1 - periodVol),
      pctRange: periodVol * 100
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
    atr,
    stochastic,
    williamsR,
    ichimoku,
    aggregateOHLC,
    riskMetrics,
    fibonacciLevels,
    week52Range,
    detectCandlestickPatterns,
    detectBreakout,
    volatilityRange
  };
})();
