/**
 * Chart helpers using Plotly.js
 */

const Charts = (() => {
  const layoutBase = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#8b9aab', size: 11, family: 'Inter, system-ui, sans-serif' },
    margin: { l: 50, r: 20, t: 20, b: 40 },
    xaxis: {
      gridcolor: '#1a222d',
      linecolor: '#2a3441',
      rangeslider: { visible: false }
    },
    yaxis: {
      gridcolor: '#1a222d',
      linecolor: '#2a3441',
      side: 'right'
    },
    legend: {
      orientation: 'h',
      y: 1.08,
      font: { size: 11 }
    },
    hovermode: 'x unified'
  };

  function priceChart(df, showBollinger = true) {
    if (typeof Plotly === 'undefined') return;
    if (!df || df.length < 5) return;
    // Last ~1 year for clarity
    const data = df.slice(-260);
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
          line: { color: 'rgba(173,216,230,0.45)', width: 1 },
          showlegend: false
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: dates,
          y: data.map(r => r.bbLower),
          name: 'BB Lower',
          line: { color: 'rgba(173,216,230,0.45)', width: 1 },
          fill: 'tonexty',
          fillcolor: 'rgba(173,216,230,0.06)',
          showlegend: false
        }
      );
    }

    const layout = {
      ...layoutBase,
      height: 420,
      yaxis: { ...layoutBase.yaxis, title: 'Price (₹)' }
    };

    Plotly.newPlot('price-chart', traces, layout, { responsive: true, displayModeBar: false });
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
