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

    // Stochastic Oscillator
    if (last.stochK != null && last.stochD != null) {
      if (last.stochK < 20 && last.stochK > (prev.stochK ?? last.stochK)) {
        bull.push(`Stochastic %K at ${last.stochK.toFixed(1)} turning up from oversold territory.`);
      } else if (last.stochK > 80 && last.stochK < (prev.stochK ?? last.stochK)) {
        bear.push(`Stochastic %K at ${last.stochK.toFixed(1)} turning down from overbought territory.`);
      }
    }

    // Williams %R
    if (last.williamsR != null) {
      if (last.williamsR <= -80) {
        bull.push(`Williams %R at ${last.williamsR.toFixed(1)} — deep oversold zone.`);
      } else if (last.williamsR >= -20) {
        bear.push(`Williams %R at ${last.williamsR.toFixed(1)} — deep overbought zone.`);
      }
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

    // Candlestick patterns from the most recent candles
    if (info.candlePatterns && info.candlePatterns.length) {
      info.candlePatterns.forEach((p) => {
        if (p.signal === 'bullish') bull.push(`Candlestick: ${p.name} detected — ${p.note}`);
        else if (p.signal === 'bearish') bear.push(`Candlestick: ${p.name} detected — ${p.note}`);
      });
    }

    // RSI/MACD divergence
    if (info.divergences && info.divergences.length) {
      info.divergences.forEach((d) => {
        if (d.type === 'bullish') bull.push(`${d.indicator} divergence: ${d.note}`);
        else if (d.type === 'bearish') bear.push(`${d.indicator} divergence: ${d.note}`);
      });
    }

    // 20-day breakout/breakdown
    if (info.breakout) {
      if (info.breakout.type === 'breakout') bull.push(`Breakout: ${info.breakout.note}`);
      else bear.push(`Breakdown: ${info.breakout.note}`);
    }

    // Ichimoku Cloud
    if (info.ichimoku && info.ichimoku.senkouA != null && info.ichimoku.senkouB != null) {
      const { price, senkouA, senkouB, tenkan, kijun } = info.ichimoku;
      const cloudTop = Math.max(senkouA, senkouB);
      const cloudBottom = Math.min(senkouA, senkouB);
      if (price > cloudTop) {
        bull.push('Price is trading above the Ichimoku Cloud — bullish trend structure.');
      } else if (price < cloudBottom) {
        bear.push('Price is trading below the Ichimoku Cloud — bearish trend structure.');
      }
      if (tenkan != null && kijun != null) {
        if (tenkan > kijun) bull.push('Ichimoku Tenkan-sen is above Kijun-sen — short-term momentum is positive.');
        else if (tenkan < kijun) bear.push('Ichimoku Tenkan-sen is below Kijun-sen — short-term momentum is negative.');
      }
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

  // ---------------- Long-Term Investment Verdict ----------------
  // Fundamentals + quality-trend only — deliberately excludes RSI, MACD,
  // candlesticks, Bollinger, Ichimoku, breakout/divergence, and every other
  // short-term technical signal in analyse() above, so a stock's long-term
  // case isn't diluted or masked by this week's price action.
  function analyseLongTerm(info) {
    const bull = [];
    const bear = [];
    const price = info.price;

    const roe = info.returnOnEquity;
    if (roe != null) {
      if (roe >= 0.15) bull.push('ROE of ' + (roe * 100).toFixed(1) + '% clears a strong long-term efficiency bar.');
      else if (roe < 0.10) bear.push('ROE of ' + (roe * 100).toFixed(1) + '% is below what durable compounders typically sustain.');
    }

    const opMargin = info.operatingMargins;
    if (opMargin != null && opMargin > 0.12) {
      bull.push('Operating margin of ' + (opMargin * 100).toFixed(1) + '% suggests durable pricing power.');
    }

    const de = info.debtToEquity;
    if (de != null) {
      if (de > 150) bear.push('Debt-to-Equity of ' + (de / 100).toFixed(2) + ' adds balance-sheet risk over a long holding period.');
      else if (de <= 100) bull.push('Conservative balance sheet — low leverage reduces long-term downside risk.');
    }

    if (info.trailingEps > 0 && info.bookValue > 0 && price > 0) {
      const graham = Math.sqrt(22.5 * info.trailingEps * info.bookValue);
      if (price < graham) {
        bull.push('Trading below Graham Number with a ' + (((graham - price) / graham) * 100).toFixed(1) + '% margin of safety.');
      } else if (price > graham * 1.4) {
        bear.push('Trading well above Graham Number — limited margin of safety for a fresh long-term entry.');
      }
    }
    if (info.grahamFormulaValue != null && price > 0) {
      const gap = ((info.grahamFormulaValue - price) / price) * 100;
      if (gap > 20) bull.push('Trading ' + gap.toFixed(1) + '% below Graham Formula fair value.');
      else if (gap < -30) bear.push('Trading ' + Math.abs(gap).toFixed(1) + '% above Graham Formula fair value.');
    }
    if (info.lynchValue != null && price > 0) {
      const gap = ((info.lynchValue - price) / price) * 100;
      if (gap > 20) bull.push('Trading ' + gap.toFixed(1) + '% below Peter Lynch fair value estimate.');
      else if (gap < -30) bear.push('Trading ' + Math.abs(gap).toFixed(1) + '% above Peter Lynch fair value estimate.');
    }
    if (info.growthFloored) {
      bear.push('TTM growth is negative — the fair-value estimates above use a conservative 5% floor rather than the real trend.');
    }

    if (info.piotroski && info.piotroski.max >= 5) {
      const ratio = info.piotroski.score / info.piotroski.max;
      if (ratio >= 0.75) bull.push('Piotroski F-Score ' + info.piotroski.score + '/' + info.piotroski.max + ' — strong fundamental checklist for a long-term hold.');
      else if (ratio <= 0.35) bear.push('Piotroski F-Score ' + info.piotroski.score + '/' + info.piotroski.max + ' — weak fundamental checklist.');
    }

    if (info.dupont) {
      if (info.dupont.equityMultiplier > 3 && info.dupont.netMargin < 8) {
        bear.push('ROE looks leverage-driven rather than operationally strong — lower quality of returns for a long-term hold.');
      } else if (info.dupont.netMargin > 15 && info.dupont.equityMultiplier < 2.5) {
        bull.push('ROE is margin-driven with modest leverage — healthier quality of returns.');
      }
    }

    if (info.qualityTrends && info.qualityTrends.length) {
      info.qualityTrends.forEach((t) => {
        if (t.color === 'var(--green)') {
          bull.push(t.label + ' has been ' + t.tag.toLowerCase() + ' since ' + t.since + ' — a positive long-term signal.');
        } else if (t.color === 'var(--red)') {
          bear.push(t.label + ' has been ' + t.tag.toLowerCase() + ' since ' + t.since + ' — worth monitoring.');
        }
      });
    }

    const total = bull.length + bear.length;
    if (total === 0) return null; // not enough fundamental data to say anything
    const bullRatio = bull.length / total;

    let verdict, cssClass, summary;
    if (bullRatio >= 0.7) {
      verdict = 'LONG-TERM BUY';
      cssClass = 'strong-buy';
      summary = 'Fundamentals, valuation, and quality trends line up well for a long-term hold, independent of short-term price action.';
    } else if (bullRatio >= 0.5) {
      verdict = 'ACCUMULATE / HOLD';
      cssClass = 'mild-buy';
      summary = 'Net positive long-term case, but not uniformly — some fundamentals or trends warrant continued monitoring.';
    } else if (bullRatio >= 0.3) {
      verdict = 'HOLD / WATCH';
      cssClass = 'neutral';
      summary = 'Mixed fundamental picture — neither a clear long-term buy nor a clear reason to exit.';
    } else {
      verdict = 'AVOID / REDUCE';
      cssClass = 'sell';
      summary = 'Weak fundamentals, deteriorating quality trends, or rich valuation outweigh the positives for a long-term hold.';
    }

    return { bull, bear, bullRatio, verdict, cssClass, summary };
  }

  // ---------------- Risk Level Verdict ----------------
  // A plain Low/Medium/High tag, independent of buy/sell direction — useful
  // for position sizing regardless of how bullish or bearish the other
  // verdicts read. Works even without price history (debt alone), so it
  // still has something to say in Screener-only fallback mode.
  function riskLevel(info) {
    const reasons = [];
    let score = 0; // higher = riskier
    let checks = 0;

    const rm = info.riskMetrics;
    if (rm) {
      if (rm.annualVol != null) {
        checks++;
        if (rm.annualVol > 45) { score++; reasons.push('Annualized volatility of ' + rm.annualVol.toFixed(1) + '% is high.'); }
        else if (rm.annualVol < 25) reasons.push('Annualized volatility of ' + rm.annualVol.toFixed(1) + '% is relatively contained.');
      }
      if (rm.maxDrawdown != null) {
        checks++;
        if (rm.maxDrawdown <= -40) { score++; reasons.push('Historical max drawdown of ' + rm.maxDrawdown.toFixed(1) + '% shows this can fall sharply.'); }
        else if (rm.maxDrawdown > -20) reasons.push('Max drawdown of ' + rm.maxDrawdown.toFixed(1) + '% has been comparatively mild.');
      }
      if (rm.sharpe != null) {
        checks++;
        if (rm.sharpe < 0) { score++; reasons.push('Negative Sharpe ratio — returns have not compensated for the volatility taken.'); }
      }
    }

    const de = info.debtToEquity;
    if (de != null) {
      checks++;
      if (de > 150) { score++; reasons.push('Debt-to-Equity of ' + (de / 100).toFixed(2) + ' adds balance-sheet risk.'); }
      else if (de <= 50) reasons.push('Low leverage reduces balance-sheet risk.');
    }

    if (!checks) return null;
    const riskRatio = score / checks;
    let level, cssClass;
    if (riskRatio >= 0.6) { level = 'High'; cssClass = 'sell'; }
    else if (riskRatio >= 0.3) { level = 'Medium'; cssClass = 'mild-buy'; }
    else { level = 'Low'; cssClass = 'strong-buy'; }

    return { level, cssClass, reasons };
  }

  // ---------------- Valuation Verdict ----------------
  // Cheap / Fair / Expensive, isolated from technicals and quality trends
  // entirely, from Graham/Lynch/Graham-Number gaps plus PEG and FCF yield.
  function valuationVerdict(info) {
    const reasons = [];
    let score = 0; // positive = cheap, negative = expensive
    let checks = 0;
    const price = info.price;

    if (info.trailingEps > 0 && info.bookValue > 0 && price > 0) {
      checks++;
      const graham = Math.sqrt(22.5 * info.trailingEps * info.bookValue);
      if (price < graham) { score++; reasons.push('Trading below Graham Number (' + (((graham - price) / graham) * 100).toFixed(1) + '% margin of safety).'); }
      else if (price > graham * 1.4) { score--; reasons.push('Trading well above Graham Number.'); }
    }
    if (info.grahamFormulaValue != null && price > 0) {
      checks++;
      const gap = ((info.grahamFormulaValue - price) / price) * 100;
      if (gap > 20) { score++; reasons.push(gap.toFixed(1) + '% below Graham Formula fair value.'); }
      else if (gap < -30) { score--; reasons.push(Math.abs(gap).toFixed(1) + '% above Graham Formula fair value.'); }
    }
    if (info.lynchValue != null && price > 0) {
      checks++;
      const gap = ((info.lynchValue - price) / price) * 100;
      if (gap > 20) { score++; reasons.push(gap.toFixed(1) + '% below Peter Lynch fair value.'); }
      else if (gap < -30) { score--; reasons.push(Math.abs(gap).toFixed(1) + '% above Peter Lynch fair value.'); }
    }
    if (info.peg != null) {
      checks++;
      if (info.peg > 0 && info.peg < 1) { score++; reasons.push('PEG ratio of ' + info.peg.toFixed(2) + ' suggests cheap relative to growth.'); }
      else if (info.peg > 2) { score--; reasons.push('PEG ratio of ' + info.peg.toFixed(2) + ' suggests expensive relative to growth.'); }
    }
    if (info.fcfYield != null) {
      checks++;
      if (info.fcfYield > 6) { score++; reasons.push('FCF yield of ' + info.fcfYield.toFixed(1) + '% is attractive.'); }
      else if (info.fcfYield < 0) { score--; reasons.push('Negative free cash flow yield.'); }
      else if (info.fcfYield < 1.5) { score--; reasons.push('FCF yield of only ' + info.fcfYield.toFixed(1) + '% is thin.'); }
    }

    if (!checks) return null;
    const ratio = (score + checks) / (2 * checks); // normalize -checks..+checks to 0..1
    let tag, cssClass;
    if (ratio >= 0.65) { tag = 'Cheap'; cssClass = 'strong-buy'; }
    else if (ratio >= 0.4) { tag = 'Fair'; cssClass = 'neutral'; }
    else { tag = 'Expensive'; cssClass = 'sell'; }

    return { tag, cssClass, reasons };
  }

  return { analyse, analyseLongTerm, riskLevel, valuationVerdict };
})();
