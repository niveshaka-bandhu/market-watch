/**
 * Multi-dimensional quant verdict engine
 * Same institutional language as the original Streamlit version
 */

const VerdictEngine = (() => {
  function analyse(df, info = {}) {
    const bull = [];
    const bear = [];

    const last = df[df.length - 1];
    const prev = df[df.length - 2] || last;

    const rsi = (last.rsi != null && !isNaN(last.rsi)) ? last.rsi : 50;
    const sma50 = last.sma50;
    const sma200 = last.sma200;
    const macdHist = last.macdHist ?? 0;

    // Trend structure
    if (sma50 != null && sma200 != null) {
      if (sma50 > sma200) {
        bull.push('Golden Cross confirmed: 50 SMA is riding structurally above the 200 SMA.');
      } else {
        bear.push('Death Cross structure: 50 SMA is trailing below the 200 SMA showing macro technical pressure.');
      }
    }

    // RSI
    if (rsi < 35) {
      bull.push(`RSI reads highly oversold at ${rsi.toFixed(1)}, signaling tactical exhaustion.`);
    } else if (rsi > 70) {
      bear.push(`RSI reads overbought at ${rsi.toFixed(1)}, flashing immediate distribution risk.`);
    }

    // MACD
    if (macdHist > 0) {
      bull.push('MACD histogram shows positive expansion above signal threshold lines.');
    } else {
      bear.push('MACD momentum shows near-term bearish convergence.');
    }

    // Price vs Bollinger
    if (last.bbLower != null && last.close < last.bbLower) {
      bull.push('Price is trading below the lower Bollinger Band — potential mean-reversion setup.');
    } else if (last.bbUpper != null && last.close > last.bbUpper) {
      bear.push('Price is extended above the upper Bollinger Band — elevated short-term risk.');
    }

    // Fundamentals (when available)
    const roe = info.returnOnEquity;
    if (roe != null) {
      if (roe >= 0.15) bull.push(`High Capital Return Efficiency: ROE sits optimally at ${(roe * 100).toFixed(2)}%.`);
      else if (roe < 0.10) bear.push(`Depressed Capital Return Efficiency: ROE trails below baseline at ${(roe * 100).toFixed(2)}%.`);
    }

    const opMargin = info.operatingMargins;
    if (opMargin != null && opMargin > 0.12) {
      bull.push(`Strong operational baseline health with core margins at ${(opMargin * 100).toFixed(2)}%.`);
    }

    const de = info.debtToEquity;
    if (de != null) {
      if (de > 150) bear.push(`Leverage Flag: High Debt-to-Equity balance noted at ${(de / 100).toFixed(2)}.`);
      else if (de <= 100) bull.push('Protected Capital Base: Leverage models track safely with clean debt levels.');
    }

    // Graham Number (when EPS & BV available)
    const eps = info.trailingEps;
    const bvps = info.bookValue;
    let graham = null;
    if (eps > 0 && bvps > 0) {
      graham = Math.sqrt(22.5 * eps * bvps);
      if (last.close < graham) {
        const mos = ((graham - last.close) / graham) * 100;
        bull.push(`Under-valued on Graham Intrinsic formulas. Trading with a ${mos.toFixed(1)}% Margin of Safety.`);
      } else if (last.close > graham * 1.4) {
        bear.push('Trading at a significant premium above historical Graham Intrinsic multiples.');
      }
    }

    // Graham Formula / Peter Lynch fair value gap
    if (info.grahamFormulaValue != null && last.close > 0) {
      const gap = ((info.grahamFormulaValue - last.close) / last.close) * 100;
      if (gap > 20) bull.push(`Trading ${gap.toFixed(1)}% below Graham Formula fair value — meaningful margin of safety.`);
      else if (gap < -30) bear.push(`Trading ${Math.abs(gap).toFixed(1)}% above Graham Formula fair value — rich premium.`);
    }
    if (info.lynchValue != null && last.close > 0) {
      const gap = ((info.lynchValue - last.close) / last.close) * 100;
      if (gap > 20) bull.push(`Trading ${gap.toFixed(1)}% below Peter Lynch fair value estimate.`);
      else if (gap < -30) bear.push(`Trading ${Math.abs(gap).toFixed(1)}% above Peter Lynch fair value estimate.`);
    }
    if (info.growthFloored) {
      bear.push('TTM growth is negative — Graham Formula/Peter Lynch values above use a conservative 5% floor rather than the actual declining trend.');
    }

    // Piotroski F-Score (only when enough underlying rows were available)
    if (info.piotroski && info.piotroski.max >= 5) {
      const ratio = info.piotroski.score / info.piotroski.max;
      if (ratio >= 0.75) bull.push(`Piotroski F-Score ${info.piotroski.score}/${info.piotroski.max} — strong fundamental quality checklist.`);
      else if (ratio <= 0.35) bear.push(`Piotroski F-Score ${info.piotroski.score}/${info.piotroski.max} — weak fundamental quality checklist.`);
    }

    // DuPont: is ROE coming from real profitability or mostly leverage?
    if (info.dupont) {
      if (info.dupont.equityMultiplier > 3 && info.dupont.netMargin < 8) {
        bear.push('ROE appears leverage-driven (high equity multiplier, thin net margin) rather than operationally strong.');
      } else if (info.dupont.netMargin > 15 && info.dupont.equityMultiplier < 2.5) {
        bull.push('ROE is margin-driven with modest leverage — healthier quality of returns.');
      }
    }

    // Risk metrics from the price history
    if (info.riskMetrics) {
      if (info.riskMetrics.sharpe != null && info.riskMetrics.sharpe < 0) {
        bear.push("Negative Sharpe ratio over the loaded history — returns haven't compensated for volatility.");
      }
      if (info.riskMetrics.maxDrawdown <= -40) {
        bear.push(`Historical max drawdown of ${info.riskMetrics.maxDrawdown.toFixed(1)}% signals high volatility risk.`);
      }
    }

    // Fibonacci proximity from the chart
    if (info.fibSupport) {
      bull.push('Price is trading near a key Fibonacci support level from the recent swing range.');
    }
    if (info.fibResistance) {
      bear.push('Price is trading near a key Fibonacci resistance level from the recent swing range.');
    }

    // Score
    const total = bull.length + bear.length;
    const bullRatio = total > 0 ? bull.length / total : 0.5;

    let master, cssClass, summary;
    if (bullRatio >= 0.75) {
      master = 'STRATEGIC ACCUMULATION (STRONG BUY)';
      cssClass = 'strong-buy';
      summary = 'The algorithmic model flags clear structural backing across multiple domains. Valuations offer a strong buffer, operational health scales cleanly above institutional hurdles, and tactical momentum signals near-term upside velocity.';
    } else if (bullRatio >= 0.55) {
      master = 'TACTICAL ACCUMULATION (MILD BUY / HOLD)';
      cssClass = 'mild-buy';
      summary = 'The company retains high core asset quality, but near-term momentum requires careful risk allocation or waiting for mild positional entry liquidations before executing major buy tickets.';
    } else if (bullRatio >= 0.35) {
      master = 'NEUTRAL WAIT / TRACKING CONTEXT';
      cssClass = 'neutral';
      summary = 'Conflicting vector paths detected. Fundamental strengths are currently being offset by poor macro price momentum or premium valuation hurdles. Maintain a neutral posture on the asset.';
    } else {
      master = 'RISK AVOIDANCE ORDER (UNDERPERFORM / SELL)';
      cssClass = 'sell';
      summary = 'Defensive frameworks triggered. High structural leverage, degrading technical baselines, or extremely overstretched multiples indicate significant downside projection risk paths.';
    }

    return {
      bull,
      bear,
      bullRatio,
      master,
      cssClass,
      summary,
      graham,
      latest: last,
      prev
    };
  }

  return { analyse };
})();
