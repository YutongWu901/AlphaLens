const paths = {
  home: "m3 10 9-7 9 7v10h-6v-6H9v6H3z",
  overview: "M3 3h7v7H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 14h7v7H3z",
  scan: "M3 5h18 M6 10h12 M9 15h6 M11 20h2",
  watch: "M12 3 14.8 8.8 21 9.7 16.5 14.1 17.6 20.3 12 17.3 6.4 20.3 7.5 14.1 3 9.7 9.2 8.8z",
  target: "M21 12a9 9 0 1 1-9-9 M17 12a5 5 0 1 1-5-5 M12 12l8-8 M17 4h3v3",
  regime: "M2 13h4l3-8 5 14 3-8h5",
  research: "M3 20h19 M5 16v-5 M10 16V5 M15 16V8 M20 16v-5",
  backtest: "M3 6v5h5 M4 10a8 8 0 1 1 1 7 M12 7v5l4 2",
  ml: "M8 5a3 3 0 0 0-4 3 4 4 0 0 0 0 7 3 3 0 0 0 4 4q4 3 4-2V7q0-5-4-2z M16 5a3 3 0 0 1 4 3 4 4 0 0 1 0 7 3 3 0 0 1-4 4q-4 3-4-2 M5 10l3 1 M16 14l3-2",
  simulation: "M3 19h18 M4 17c4 0 3-10 8-10s4 10 8 10 M12 4v2",
  portfolio: "M3 7h18v13H3z M8 7V4h8v3 M3 12q9 5 18 0 M11 13h2",
  data: "M3 6c0-4 18-4 18 0s-18 4-18 0 M3 6v12c0 4 18 4 18 0V6 M3 12c0 4 18 4 18 0",
  search: "M16 16l5 5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  calendar: "M4 6h16v15H4z M8 3v5 M16 3v5 M4 11h16",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  chart: "M3 4v16h18 M6 15l4-5 4 2 6-7",
  sliders: "M3 6h5m4 0h9 M3 12h10m4 0h4 M3 18h3m4 0h11 M8 4h4v4H8z M13 10h4v4h-4z M6 16h4v4H6z",
  chevron: "m8 10 4 4 4-4",
  right: "m9 6 6 6-6 6",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M3 12h18 M12 3c-5 4-5 14 0 18 5-4 5-14 0-18",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 7v5l3 2",
  layers: "m3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 11v6 M12 7v.1",
  refresh: "M20 4v6h-6 M4 20v-6h6 M4 9a8 8 0 0 1 15-2 M20 15a8 8 0 0 1-15 2",
  list: "M9 6h12 M9 12h12 M9 18h12 M3 6h1 M3 12h1 M3 18h1",
  plus: "M12 5v14 M5 12h14",
};
export const ic = (k) =>
  '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' +
  (paths[k] || paths.chart) +
  '"/></svg>';
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export const num = (v, d = 2) =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
export const pct = (v, d = 2, sign = true) =>
  Number.isFinite(v) ? (v > 0 && sign ? "+" : "") + num(v * 100, d) + "%" : "—";
export const clr = (v) => (v > 0 ? "positive" : v < 0 ? "negative" : "muted");
let seq = 0;
export function spark(a, color = "#ae96ff", width = 100, height = 34, area = false) {
  const values = a.filter(Number.isFinite);
  if (values.length < 2) return "";
  const lo = Math.min(...values),
    hi = Math.max(...values),
    id = "grad" + ++seq;
  const points = values
    .map((v, i) =>
      [
        ((i / (values.length - 1)) * width).toFixed(1),
        (height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6)).toFixed(1),
      ].join(","),
    )
    .join(" ");
  return (
    '<svg class="spark" viewBox="0 0 ' +
    width +
    " " +
    height +
    '" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="' +
    id +
    '" x1="0" y1="0" x2="0" y2="1"><stop stop-color="' +
    color +
    '" stop-opacity=".28"/><stop offset="1" stop-color="' +
    color +
    '" stop-opacity="0"/></linearGradient></defs>' +
    (area
      ? '<polygon points="0,' +
        height +
        " " +
        points +
        " " +
        width +
        "," +
        height +
        '" fill="url(#' +
        id +
        ')"/>'
      : "") +
    '<polyline points="' +
    points +
    '" fill="none" stroke="' +
    color +
    '" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>'
  );
}
export function plot(el, series, { percent = true, unit = "", digits = 1 } = {}) {
  if (!el) return;
  const good = series.filter((s) => s.rows.length > 1);
  if (!good.length) {
    el.innerHTML = '<div class="empty">此区间数据不足</div>';
    return;
  }
  const maps = good.map((s) => new Map(s.rows));
  const dates = good[0].rows.map((p) => p[0]).filter((d) => maps.every((m) => Number.isFinite(m.get(d))));
  if (dates.length < 2) {
    el.textContent = "共同交易日不足";
    return;
  }
  const width = Math.max(300, el.clientWidth || 640),
    height = el.clientHeight || 210,
    L = 42,
    R = 12,
    T = 13,
    B = 24,
    w = width - L - R,
    h = height - T - B;
  const vals = maps.map((m) =>
    dates.map((d) => (percent ? (m.get(d) / m.get(dates[0]) - 1) * 100 : m.get(d))),
  );
  const mn = Math.min(...vals.flat(), ...(percent ? [0] : [])),
    mx = Math.max(...vals.flat(), ...(percent ? [0] : []));
  const span = mx - mn || 1;
  const raw = span / 4,
    pow = 10 ** Math.floor(Math.log10(raw)),
    scale = raw / pow,
    step = (scale <= 1 ? 1 : scale <= 2 ? 2 : scale <= 2.5 ? 2.5 : scale <= 5 ? 5 : 10) * pow;
  const lo = Math.floor(mn / step) * step,
    hi = Math.max(lo + step, Math.ceil(mx / step) * step),
    x = (i) => L + (i * w) / (dates.length - 1),
    y = (v) => T + ((hi - v) / (hi - lo)) * h;
  const id = "area" + ++seq,
    tag = (attrs, t) =>
      '<text fill="#8992a7" font-family="Consolas,monospace" font-size="11" ' + attrs + ">" + t + "</text>";
  let html =
    '<defs><linearGradient id="' +
    id +
    '" x1="0" y1="0" x2="0" y2="1"><stop stop-color="' +
    good[0].color +
    '" stop-opacity=".17"/><stop offset="1" stop-color="' +
    good[0].color +
    '" stop-opacity="0"/></linearGradient></defs>';
  for (let v = lo; v <= hi + step * 0.01; v += step) {
    html +=
      '<line x1="' +
      L +
      '" x2="' +
      (width - R) +
      '" y1="' +
      y(v) +
      '" y2="' +
      y(v) +
      '" stroke="#2a2d3b" stroke-dasharray="3 4"/>' +
      tag(
        'x="' + (L - 7) + '" y="' + (y(v) + 4) + '" text-anchor="end"',
        num(v, step < 1 ? 1 : 0) + (percent ? "%" : ""),
      );
  }
  const n = width < 500 ? 4 : 6;
  for (let j = 0; j < n; j++) {
    const i = Math.round(((dates.length - 1) * j) / (n - 1)),
      d = dates[i];
    html += tag(
      'x="' +
        x(i) +
        '" y="' +
        (height - 3) +
        '" text-anchor="' +
        (j === 0 ? "start" : j === n - 1 ? "end" : "middle") +
        '"',
      dates.length < 50 ? d.slice(5) : d.slice(0, 7),
    );
  }
  vals.forEach((v, k) => {
    const path = v.map((p, i) => (i ? "L" : "M") + x(i).toFixed(2) + " " + y(p).toFixed(2)).join("");
    if (!k)
      html +=
        '<path d="' +
        path +
        " L" +
        x(dates.length - 1) +
        " " +
        (T + h) +
        " L" +
        L +
        " " +
        (T + h) +
        ' Z" fill="url(#' +
        id +
        ')"/>';
    html +=
      '<path d="' +
      path +
      '" fill="none" stroke="' +
      good[k].color +
      '" stroke-width="2" stroke-linejoin="round"/><circle cx="' +
      x(dates.length - 1) +
      '" cy="' +
      y(v.at(-1)) +
      '" r="2.6" fill="' +
      good[k].color +
      '"/>';
  });
  el.innerHTML =
    '<svg role="img" aria-label="历史表现，移动指针查看交易日数据" viewBox="0 0 ' +
    width +
    " " +
    height +
    '">' +
    html +
    '<line class="cross" visibility="hidden" y1="' +
    T +
    '" y2="' +
    (T + h) +
    '" stroke="#b0a8ca" stroke-dasharray="3 3"/></svg><div class="chart-tip" hidden></div>';
  const tip = el.querySelector(".chart-tip"),
    cross = el.querySelector(".cross");
  el.onpointermove = (e) => {
    const p = ((e.clientX - el.getBoundingClientRect().left) / el.clientWidth) * width;
    const i = Math.min(dates.length - 1, Math.max(0, Math.round(((p - L) / w) * (dates.length - 1))));
    tip.hidden = false;
    tip.style.left = Math.max(1, Math.min(el.clientWidth - 125, p + 10)) + "px";
    tip.innerHTML =
      dates[i] +
      good
        .map(
          (s, k) =>
            '<br><span style="color:' +
            s.color +
            '">' +
            esc(s.name) +
            "</span> " +
            num(vals[k][i], digits) +
            (percent ? "%" : unit),
        )
        .join("");
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
  };
  el.onpointerleave = () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
  };
}
export function gauge(key, name) {
  const idx = { bear: 0, volatile: 1, range: 2, bull: 3 }[key];
  const colors = ["#ec8192", "#dca86e", "#b6a0e8", "#62d7b2"];
  const x = (a) => 120 + 93 * Math.cos((a * Math.PI) / 180),
    y = (a) => 106 - 93 * Math.sin((a * Math.PI) / 180);
  let h = "";
  for (let i = 0; i < 48; i++) {
    const a = 180 - i * 3.75 - 0.5,
      b = a - 2.9;
    h +=
      '<path d="M' +
      x(a) +
      " " +
      y(a) +
      " A93 93 0 0 1 " +
      x(b) +
      " " +
      y(b) +
      '" stroke="' +
      colors[Math.floor(i / 12)] +
      '" stroke-width="9" fill="none"/>';
  }
  if (idx !== undefined) {
    const a = 180 - (idx + 0.5) * 45,
      r = (a * Math.PI) / 180;
    h +=
      '<path d="M' +
      (120 - 4 * Math.sin(r)) +
      " " +
      (106 - 4 * Math.cos(r)) +
      " L" +
      (120 + 73 * Math.cos(r)) +
      " " +
      (106 - 73 * Math.sin(r)) +
      " L" +
      (120 + 4 * Math.sin(r)) +
      " " +
      (106 + 4 * Math.cos(r)) +
      'Z" fill="#ded9ee"/><circle cx="120" cy="106" r="6" fill="#bfaddf"/>';
  }
  return (
    '<div class="gauge"><svg viewBox="0 0 240 139" aria-label="' +
    esc(name) +
    '">' +
    h +
    '<text x="22" y="126" fill="#949aad" font-size="11">熊市</text><text x="197" y="126" fill="#949aad" font-size="11">牛市</text></svg><div class="gauge-label" style="color:' +
    (colors[idx] || "#aaa") +
    '">' +
    esc(name) +
    "</div></div>"
  );
}
