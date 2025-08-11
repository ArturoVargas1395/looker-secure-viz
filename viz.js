/* Secure Radar (Pitch Scorecard) for Looker Studio
 * - No network calls; no data exfiltration.
 * - Loads Chart.js from CDN (optional: host it yourself, see note below).
 */

(function () {
  // --- Load Chart.js once ---
  const CHARTJS_SRC = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
  let chartJsLoaded = false;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // Root/container + canvas
  let canvas, ctx, chart;
  function ensureCanvas() {
    let root = document.getElementById("root");
    if (!root) {
      root = document.createElement("div");
      root.id = "root";
      document.body.appendChild(root);
    }
    if (!canvas) {
      canvas = document.createElement("canvas");
      root.innerHTML = ""; // clear
      root.appendChild(canvas);
      ctx = canvas.getContext("2d");
    }
  }

  // Pastel color from label (stable hash)
  function pastelFor(label, alpha = 0.2) {
    const str = String(label ?? "");
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    // HSL to RGBA (soft)
    const hue = h % 360;
    const sat = 55, light = 68;
    // Rough HSL->RGB
    const c = (1 - Math.abs(2 * light / 100 - 1)) * (sat / 100);
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = light / 100 - c / 2;
    let [r1, g1, b1] = [0, 0, 0];
    if (0 <= hue && hue < 60) [r1, g1, b1] = [c, x, 0];
    else if (60 <= hue && hue < 120) [r1, g1, b1] = [x, c, 0];
    else if (120 <= hue && hue < 180) [r1, g1, b1] = [0, c, x];
    else if (180 <= hue && hue < 240) [r1, g1, b1] = [0, x, c];
    else if (240 <= hue && hue < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const to255 = v => Math.round((v + m) * 255);
    const r = to255(r1), g = to255(g1), b = to255(b1);
    return {
      border: `rgba(${r}, ${g}, ${b}, 0.9)`,
      fill:   `rgba(${r}, ${g}, ${b}, ${alpha})`
    };
  }

  // Main draw: expects first dimension to be your "series" (e.g., Month or Person).
  function draw(data) {
    ensureCanvas();

    // DataStudio/Looker Studio transform gives this shape:
    // data.tables.DEFAULT = [{dimensionValues:[...], metricValues:[...]}, ...]
    const table = (data && data.tables && data.tables.DEFAULT) || [];
    const metricFields = (data && data.fields && data.fields.metrics) || [];
    const dimFields = (data && data.fields && data.fields.dimensions) || [];

    // Axis labels (must be your 8 metrics in order)
    const axisLabels = metricFields.map(f => f.name);

    // Group rows by first dimension value (series). If none, use "All".
    const keyIndex = 0;
    const groups = new Map();
    for (const row of table) {
      const key = (row.dimensionValues && row.dimensionValues[keyIndex] && (row.dimensionValues[keyIndex].formattedValue ?? row.dimensionValues[keyIndex].value)) || "All";
      const vals = row.metricValues.map(m => Number(m.value ?? m.formattedValue ?? m) || 0);
      if (!groups.has(key)) groups.set(key, { sums: Array(vals.length).fill(0), count: 0 });
      const g = groups.get(key);
      for (let i = 0; i < vals.length; i++) g.sums[i] += vals[i];
      g.count += 1;
    }

    // Build datasets (average per metric per series)
    const datasets = [];
    for (const [label, g] of groups.entries()) {
      const avg = g.sums.map(s => (g.count ? s / g.count : 0));
      const c = pastelFor(label, 0.18);
      datasets.push({
        label,
        data: avg,
        fill: true,
        backgroundColor: c.fill,
        borderColor: c.border,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 3,
        pointHitRadius: 6
      });
    }

    // Init chart (Chart.js)
    const start = () => {
      if (chart) chart.destroy();
      chart = new Chart(ctx, {
        type: "radar",
        data: {
          labels: axisLabels, // 8 axes
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top", labels: { boxWidth: 18 } },
            tooltip: { enabled: true }
          },
          scales: {
            r: {
              beginAtZero: true,
              suggestedMax: 5,
              min: 0,
              max: 5,
              ticks: { stepSize: 1, showLabelBackdrop: false },
              grid: { circular: true },
              angleLines: { color: getComputedStyle(document.documentElement).getPropertyValue('--grid') || '#e5e7eb' },
              pointLabels: { font: { size: 11 } }
            }
          },
          elements: { line: { tension: 0.2 } } // slight curve, FIFA-ish
        }
      });
    };

    if (chartJsLoaded) start();
    else {
      chartJsLoaded = true;
      loadScript(CHARTJS_SRC).then(start).catch((e) => {
        console.error("Failed to load Chart.js", e);
      });
    }
  }

  // Subscribe to Looker Studio data (support old/new namespaces)
  const dscc = window.dscc || (window.lookerstudio && window.lookerstudio.dscc) || window.lookerstudio;
  const subscribe = () => {
    try {
      // Prefer dscc if available
      if (dscc && dscc.subscribeToData && dscc.tableTransform) {
        dscc.subscribeToData(draw, { transform: dscc.tableTransform });
      } else if (window.addEventListener) {
        // Fallback: listen for postMessage from Looker Studio (advanced/rare)
        window.addEventListener("message", (e) => {
          const msg = e && e.data;
          if (msg && msg.type === "looker_studio") draw(msg.data);
        });
      }
    } catch (e) {
      console.error("Subscription error:", e);
    }
  };

  // Apply CSS (when not injected by Looker)
  (function ensureCss() {
    const has = [...document.styleSheets].some(ss => (ss.href || "").includes("viz.css"));
    if (!has) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("viz.css", document.currentScript && document.currentScript.src || location.href).href;
      document.head.appendChild(link);
    }
  })();

  // Kick off
  subscribe();
})();
