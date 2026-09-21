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

    if (info.altman) {
      if (info.altman.zone === 'Distress Zone') bear.push('Altman Z-Score of ' + info.altman.z.toFixed(2) + ' falls in the Distress Zone — elevated bankruptcy-risk signal.');
      else if (info.altman.zone === 'Safe Zone') bull.push('Altman Z-Score of ' + info.altman.z.toFixed(2) + ' falls in the Safe Zone.');
    }
    if (info.roicWacc) {
      if (info.roicWacc.creatingValue) bull.push('ROIC (' + info.roicWacc.roic.toFixed(1) + '%) exceeds WACC (' + info.roicWacc.wacc.toFixed(1) + '%) — the business is creating shareholder value.');
      else bear.push('ROIC (' + info.roicWacc.roic.toFixed(1) + '%) is below WACC (' + info.roicWacc.wacc.toFixed(1) + '%) — capital may be earning less than its cost.');
    }
    if (info.ruleOf40) {
      if (info.ruleOf40.healthy) bull.push('Rule of 40 score of ' + info.ruleOf40.score.toFixed(1) + '% — growth and profitability are scaling in a healthy balance.');
    }
    if (info.acquirersMultiple && info.acquirersMultiple.cheap) {
      bull.push("Acquirer's Multiple of " + info.acquirersMultiple.multiple.toFixed(2) + 'x is in classic deep-value territory.');
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

    if (info.altman) {
      checks++;
      if (info.altman.zone === 'Distress Zone') { score++; reasons.push('Altman Z-Score sits in the Distress Zone — elevated bankruptcy-risk signal.'); }
      else if (info.altman.zone === 'Safe Zone') reasons.push('Altman Z-Score sits in the Safe Zone.');
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
    if (info.magicFormulaYield != null) {
      checks++;
      if (info.magicFormulaYield > 12) { score++; reasons.push('Magic Formula earnings yield of ' + info.magicFormulaYield.toFixed(1) + '% is attractive.'); }
      else if (info.magicFormulaYield < 5) { score--; reasons.push('Magic Formula earnings yield of only ' + info.magicFormulaYield.toFixed(1) + '% is low.'); }
    }

    if (!checks) return null;
    const ratio = (score + checks) / (2 * checks); // normalize -checks..+checks to 0..1
    let tag, cssClass;
    if (ratio >= 0.65) { tag = 'Cheap'; cssClass = 'strong-buy'; }
    else if (ratio >= 0.4) { tag = 'Fair'; cssClass = 'neutral'; }
    else { tag = 'Expensive'; cssClass = 'sell'; }

    return { tag, cssClass, reasons };
  }

  // ---------------- NB Score ----------------
  // Piotroski-style pass/fail checklist: 3 points from chart/technical
  // signals, 7 from fundamentals. Deliberately favors trend confirmation
  // and momentum health over short-term trading signals on the chart side,
  // and quality/balance-sheet/valuation checks on the fundamental side —
  // built for long-term investors, not traders. Like Piotroski, any check
  // that can't be evaluated (missing data) is left out of both the
  // numerator and the denominator rather than counted as a fail.
  function nbScore(info) {
    const checks = [
      {
        label: 'Price above SMA200 (long-term uptrend)',
        pass: info.sma200 != null && info.price != null ? info.price > info.sma200 : null
      },
      {
        label: 'MACD bullish (MACD > Signal)',
        pass: info.macdHist != null ? info.macdHist > 0 : null
      },
      {
        label: 'No bearish divergence (last 40 sessions)',
        pass: info.divergences ? !info.divergences.some((dv) => dv.type === 'bearish') : null
      },
      {
        label: 'ROE ≥ 15%',
        pass: info.returnOnEquity != null ? info.returnOnEquity >= 0.15 : null
      },
      {
        label: 'Debt-to-Equity ≤ 100%',
        pass: info.debtToEquity != null ? info.debtToEquity <= 100 : null
      },
      {
        label: 'ROIC > WACC (creating value)',
        pass: info.roicWacc ? info.roicWacc.creatingValue : null
      },
      {
        label: 'Promoter holding stable or rising',
        pass: (() => {
          if (!info.qualityTrends) return null;
          const p = info.qualityTrends.find((t) => t.label === 'Promoter Holding');
          return p ? p.color !== 'var(--red)' : null;
        })()
      },
      {
        label: 'Profit growth (3Y) ≥ Sales growth (3Y)',
        pass: info.profitGrowthY3 != null && info.salesGrowthY3 != null ? info.profitGrowthY3 >= info.salesGrowthY3 : null
      },
      {
        label: 'Trading below Graham Number',
        pass:
          info.trailingEps > 0 && info.bookValue > 0 && info.price > 0
            ? info.price < Math.sqrt(22.5 * info.trailingEps * info.bookValue)
            : null
      },
      {
        label: 'Altman Z-Score in Safe/Grey Zone',
        pass: info.altman ? info.altman.zone !== 'Distress Zone' : null
      }
    ];

    const evaluated = checks.filter((c) => c.pass !== null);
    if (!evaluated.length) return null;
    const score = evaluated.filter((c) => c.pass).length;
    const max = evaluated.length;
    const ratio = score / max;
    let tag, cssClass;
    if (ratio >= 0.8) { tag = 'Excellent'; cssClass = 'strong-buy'; }
    else if (ratio >= 0.6) { tag = 'Good'; cssClass = 'mild-buy'; }
    else if (ratio >= 0.4) { tag = 'Average'; cssClass = 'neutral'; }
    else { tag = 'Weak'; cssClass = 'sell'; }

    return { score, max, tag, cssClass, checks };
  }

  // ---------------- Complete Technical Analysis Summary ----------------
  // Consolidates every chart-based signal already computed elsewhere into
  // one categorized short-term read — the same underlying signals the
  // Master Verdict blends into a single number, but organized the way a
  // technical analyst actually presents a "complete chart analysis": by
  // category, not as one score.
  function technicalSummary(df, info) {
    if (!df || df.length < 20) return null;
    const last = df[df.length - 1];
    const categories = [];

    const trend = [];
    if (last.sma50 != null && last.sma200 != null) {
      if (last.close > last.sma50 && last.sma50 > last.sma200) {
        trend.push({ bullish: true, text: 'Price above both SMA50 and SMA200, with SMA50 above SMA200 — established uptrend.' });
      } else if (last.close < last.sma50 && last.sma50 < last.sma200) {
        trend.push({ bullish: false, text: 'Price below both SMA50 and SMA200, with SMA50 below SMA200 — established downtrend.' });
      } else {
        trend.push({ bullish: null, text: 'Price is mixed relative to its moving averages — no clean trend.' });
      }
    }
    if (info.ichimoku && info.ichimoku.senkouA != null && info.ichimoku.senkouB != null) {
      const cloudTop = Math.max(info.ichimoku.senkouA, info.ichimoku.senkouB);
      const cloudBottom = Math.min(info.ichimoku.senkouA, info.ichimoku.senkouB);
      if (info.ichimoku.price > cloudTop) trend.push({ bullish: true, text: 'Price is above the Ichimoku cloud — bullish trend structure.' });
      else if (info.ichimoku.price < cloudBottom) trend.push({ bullish: false, text: 'Price is below the Ichimoku cloud — bearish trend structure.' });
      else trend.push({ bullish: null, text: 'Price is inside the Ichimoku cloud — no clear trend, a caution zone.' });
    }
    categories.push({ name: 'Trend', signals: trend });

    const momentum = [];
    if (last.rsi != null) {
      if (last.rsi > 70) momentum.push({ bullish: false, text: 'RSI at ' + last.rsi.toFixed(1) + ' — overbought, momentum stretched.' });
      else if (last.rsi < 30) momentum.push({ bullish: true, text: 'RSI at ' + last.rsi.toFixed(1) + ' — oversold, potential bounce zone.' });
      else if (last.rsi >= 50) momentum.push({ bullish: true, text: 'RSI at ' + last.rsi.toFixed(1) + ' — leaning positive.' });
      else momentum.push({ bullish: false, text: 'RSI at ' + last.rsi.toFixed(1) + ' — leaning negative.' });
    }
    if (last.macdHist != null) {
      momentum.push({
        bullish: last.macdHist > 0,
        text: 'MACD histogram is ' + (last.macdHist > 0 ? 'positive' : 'negative') + ' — ' + (last.macdHist > 0 ? 'bullish' : 'bearish') + ' momentum.'
      });
    }
    categories.push({ name: 'Momentum', signals: momentum });

    const volatility = [];
    if (last.bbUpper != null && last.bbLower != null && last.bbUpper > last.bbLower) {
      const bbPos = (last.close - last.bbLower) / (last.bbUpper - last.bbLower);
      if (bbPos > 0.95) volatility.push({ bullish: false, text: 'Price is at the upper Bollinger Band — statistically stretched short-term.' });
      else if (bbPos < 0.05) volatility.push({ bullish: true, text: 'Price is at the lower Bollinger Band — statistically stretched to the downside.' });
      else volatility.push({ bullish: null, text: 'Price sits within its normal Bollinger range.' });
    }
    if (last.atr != null && last.close > 0) {
      const atrPct = (last.atr / last.close) * 100;
      volatility.push({ bullish: null, text: 'ATR is ' + atrPct.toFixed(1) + '% of price — ' + (atrPct > 3 ? 'elevated' : 'normal') + ' daily volatility.' });
    }
    categories.push({ name: 'Volatility', signals: volatility });

    const sr = [];
    if (last.high != null && last.low != null && last.close != null) {
      const pivot = (last.high + last.low + last.close) / 3;
      sr.push({
        bullish: last.close > pivot,
        text:
          last.close > pivot
            ? 'Trading above the daily pivot (₹' + pivot.toFixed(1) + ') — near-term bias leans positive.'
            : 'Trading below the daily pivot (₹' + pivot.toFixed(1) + ') — near-term bias leans negative.'
      });
    }
    categories.push({ name: 'Support & Resistance', signals: sr });

    const patterns = [];
    if (info.candlePatterns && info.candlePatterns.length) {
      info.candlePatterns.forEach((p) => {
        patterns.push({ bullish: p.signal === 'bullish' ? true : p.signal === 'bearish' ? false : null, text: p.name + ' — ' + p.note });
      });
    }
    if (info.breakout) {
      patterns.push({
        bullish: info.breakout.type === 'breakout',
        text: (info.breakout.type === 'breakout' ? 'Breakout: ' : 'Breakdown: ') + info.breakout.note
      });
    }
    if (info.divergences && info.divergences.length) {
      info.divergences.forEach((d) => {
        patterns.push({ bullish: d.type === 'bullish', text: (d.type === 'bullish' ? 'Bullish' : 'Bearish') + ' divergence on ' + d.indicator + ' — ' + d.note });
      });
    }
    categories.push({ name: 'Patterns', signals: patterns });

    let bull = 0, bear = 0;
    categories.forEach((c) => c.signals.forEach((s) => { if (s.bullish === true) bull++; else if (s.bullish === false) bear++; }));
    const total = bull + bear;
    if (!total) return null;
    const ratio = bull / total;
    let overall, cssClass;
    if (ratio >= 0.65) { overall = 'Short-Term Bullish'; cssClass = 'strong-buy'; }
    else if (ratio >= 0.5) { overall = 'Mildly Bullish'; cssClass = 'mild-buy'; }
    else if (ratio >= 0.35) { overall = 'Mildly Bearish'; cssClass = 'neutral'; }
    else { overall = 'Short-Term Bearish'; cssClass = 'sell'; }

    return { categories, overall, cssClass, bull, bear };
  }

  return { analyse, analyseLongTerm, riskLevel, valuationVerdict, nbScore, technicalSummary };
})();
