/**
 * Chart helpers using Plotly.js
 */

const Charts = (() => {
  const isMobileDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark) and (max-width: 768px)').matches;
  const isLight = !isMobileDark;

  const gridColor = isLight ? '#e2e6eb' : '#1a222d';
  const lineColor = isLight ? '#c7ccd3' : '#2a3441';
  const fontColor = isLight ? '#5b6672' : '#8b9aab';
  const bbFill = isLight ? 'rgba(37,99,235,0.06)' : 'rgba(173,216,230,0.06)';
  const bbLine = isLight ? 'rgba(37,99,235,0.35)' : 'rgba(173,216,230,0.45)';

  const layoutBase = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: fontColor, size: 11, family: 'Inter, system-ui, sans-serif' },
    margin: { l: 50, r: 68, t: 20, b: 40 },
    xaxis: {
      gridcolor: gridColor,
      linecolor: lineColor,
      rangeslider: { visible: false }
    },
    yaxis: {
      gridcolor: gridColor,
      linecolor: lineColor,
      side: 'right'
    },
    legend: {
      orientation: 'h',
      y: 1.08,
      font: { size: 11 }
    },
    hovermode: 'x unified'
  };

  function nextTradingDates(lastDateStr, count) {
    const dates = [];
    let d = new Date(lastDateStr + 'T00:00:00Z');
    while (dates.length < count) {
      d = new Date(d.getTime() + 86400000);
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  function priceChart(df, showBollinger = true, fibLevels = null, daysToShow = 260, targetId = 'price-chart', ichimokuData = null) {
    if (typeof Plotly === 'undefined') return;
    if (!df || df.length < 5) return;
    const data = daysToShow ? df.slice(-daysToShow) : df;
    const dates = data.map(r => r.date);

    const traces = [
      {
        type: 'candlestick',
        x: dates,
        open: data.map(r => r.open),
        high: data.map(r => r.high),
        low: data.map(r => r.low),
        close: data.map(r => r.close),
        name: 'Price',
        increasing: { line: { color: '#22c55e' }, fillcolor: '#22c55e' },
        decreasing: { line: { color: '#ef4444' }, fillcolor: '#ef4444' }
      },
      {
        type: 'scatter',
        mode: 'lines',
        x: dates,
        y: data.map(r => r.sma50),
        name: '50 SMA',
        line: { color: '#3b82f6', width: 1.4 }
      },
      {
        type: 'scatter',
        mode: 'lines',
        x: dates,
        y: data.map(r => r.sma200),
        name: '200 SMA',
        line: { color: '#f97316', width: 1.4 }
      }
    ];

    if (showBollinger) {
      traces.push(
        {
          type: 'scatter',
          mode: 'lines',
          x: dates,
          y: data.map(r => r.bbUpper),
          name: 'BB Upper',
          line: { color: bbLine, width: 1 },
          showlegend: false
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: dates,
          y: data.map(r => r.bbLower),
          name: 'BB Lower',
          line: { color: bbLine, width: 1 },
          fill: 'tonexty',
          fillcolor: bbFill,
          showlegend: false
        }
      );
    }

    if (ichimokuData && data.length) {
      const offset = df.length - data.length;
      const sliceArr = (arr) => arr.slice(offset);
      const tenkanSlice = sliceArr(ichimokuData.tenkan);
      const kijunSlice = sliceArr(ichimokuData.kijun);
      const senkouASlice = sliceArr(ichimokuData.senkouA);
      const senkouBSlice = sliceArr(ichimokuData.senkouB);
      const chikouSlice = sliceArr(ichimokuData.chikou);

      traces.push(
        {
          type: 'scatter', mode: 'lines', x: dates, y: tenkanSlice,
          name: 'Tenkan-sen (9)', line: { color: '#e11d48', width: 1 }
        },
        {
          type: 'scatter', mode: 'lines', x: dates, y: kijunSlice,
          name: 'Kijun-sen (26)', line: { color: '#2563eb', width: 1 }
        },
        {
          type: 'scatter', mode: 'lines', x: dates, y: chikouSlice,
          name: 'Chikou Span', line: { color: '#84cc16', width: 1, dash: 'dot' }
        }
      );

      // Cloud (Senkou Span A/B) projects 26 trading days into the future —
      // extend the date axis with future weekday dates for those two traces
      // only. Simplification: the cloud fill uses one translucent color
      // regardless of whether A is above or below B (a true implementation
      // colors bullish/bearish segments differently, which needs splitting
      // the fill into separate segments — not done here to keep this a
      // single readable pass).
      const futureDates = nextTradingDates(dates[dates.length - 1], 26);
      const extendedDates = dates.concat(futureDates);
      const cloudLen = extendedDates.length;
      const senkouADisplay = new Array(cloudLen).fill(null);
      const senkouBDisplay = new Array(cloudLen).fill(null);
      for (let i = 0; i < senkouASlice.length; i++) {
        const pos = i + 26;
        if (pos < cloudLen) {
          senkouADisplay[pos] = senkouASlice[i];
          senkouBDisplay[pos] = senkouBSlice[i];
        }
      }
      const cloudFill = isLight ? 'rgba(37,99,235,0.08)' : 'rgba(59,130,246,0.10)';
      const cloudLine = isLight ? 'rgba(37,99,235,0.3)' : 'rgba(59,130,246,0.35)';
      traces.push(
        {
          type: 'scatter', mode: 'lines', x: extendedDates, y: senkouADisplay,
          name: 'Senkou Span A', line: { color: cloudLine, width: 1 }, showlegend: false
        },
        {
          type: 'scatter', mode: 'lines', x: extendedDates, y: senkouBDisplay,
          name: 'Senkou Span B (Cloud)', line: { color: cloudLine, width: 1 },
          fill: 'tonexty', fillcolor: cloudFill
        }
      );
    }

    const shapes = [];
    const annotations = [];
    if (fibLevels && fibLevels.length) {
      const fibColor = isLight ? 'rgba(234,88,12,0.55)' : 'rgba(249,115,22,0.55)';
      fibLevels.forEach((lvl) => {
        shapes.push({
          type: 'line',
          xref: 'paper',
          x0: 0,
          x1: 1,
          y0: lvl.price,
          y1: lvl.price,
          line: { color: fibColor, width: 1, dash: 'dot' }
        });
        annotations.push({
          xref: 'paper',
          x: 1,
          xanchor: 'left',
          y: lvl.price,
          yanchor: 'middle',
          text: lvl.label,
          showarrow: false,
          font: { size: 9, color: fibColor }
        });
      });
    }

    const isFullscreen = targetId.replace(/^#/, '') === 'price-chart-fullscreen';

    const layout = {
      ...layoutBase,
      // Fixed height works on desktop's fullscreen overlay since the viewport
      // is comfortably taller than 420px. On mobile landscape (which the
      // expand button rotates into), total screen height can be well under
      // 420px, so the chart overflowed its container and clipped the x-axis
      // time labels at the bottom. Fullscreen instead autosizes to whatever
      // height the flex container actually has.
      ...(isFullscreen ? { autosize: true } : { height: 420 }),
      shapes,
      annotations,
      margin: isFullscreen
        ? { ...layoutBase.margin, b: 50 }
        : layoutBase.margin,
      xaxis: {
        ...layoutBase.xaxis,
        type: 'date',
        autorange: true,
        // Skip non-trading days so the candles aren't stretched across
        // empty weekend gaps — this is what made short histories (e.g. a
        // newly-listed stock with only a few weeks of data) look like they
        // spanned a much longer, near-empty range.
        rangebreaks: [{ pattern: 'day of week', bounds: [6, 1] }]
      },
      yaxis: {
        ...layoutBase.yaxis,
        title: 'Price (₹)',
        tickformat: ',.0f',
        hoverformat: ',.2f',
        separatethousands: true
      }
    };

    Plotly.newPlot(targetId.replace(/^#/, ''), traces, layout, { responsive: true, displayModeBar: false });
  }

  function monteCarloChart(simMatrix) {
    if (typeof Plotly === 'undefined' || !simMatrix || !simMatrix.length) return;
    const traces = [];
    const n = simMatrix[0].length;
    // sample ~80 paths for performance
    const step = Math.max(1, Math.floor(n / 80));
    for (let s = 0; s < n; s += step) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        y: simMatrix.map(row => row[s]),
        line: { width: 0.7, color: 'rgba(59,130,246,0.35)' },
        showlegend: false,
        hoverinfo: 'skip'
      });
    }

    // median path
    const median = simMatrix.map(row => {
      const sorted = [...row].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    });
    traces.push({
      type: 'scatter',
      mode: 'lines',
      y: median,
      name: 'Median Path',
      line: { width: 2.2, color: '#3b82f6' }
    });

    const layout = {
      ...layoutBase,
      height: 380,
      xaxis: { ...layoutBase.xaxis, title: 'Trading Days Forward' },
      yaxis: { ...layoutBase.yaxis, title: 'Simulated Price (₹)' }
    };

    Plotly.newPlot('mc-chart', traces, layout, { responsive: true, displayModeBar: false });
  }

  function backtestChart(dates, strategy, buyHold) {
    if (typeof Plotly === 'undefined' || !dates || !dates.length) return;
    const traces = [
      {
        type: 'scatter',
        mode: 'lines',
        x: dates,
        y: strategy,
        name: 'Strategy',
        line: { color: '#22c55e', width: 2 }
      },
      {
        type: 'scatter',
        mode: 'lines',
        x: dates,
        y: buyHold,
        name: 'Buy & Hold',
        line: { color: '#6b7280', width: 1.5, dash: 'dash' }
      }
    ];

    const layout = {
      ...layoutBase,
      height: 380,
      yaxis: { ...layoutBase.yaxis, title: 'Portfolio Value (₹)' }
    };

    Plotly.newPlot('bt-chart', traces, layout, { responsive: true, displayModeBar: false });
  }

  return {
    priceChart,
    monteCarloChart,
    backtestChart
  };
})();
