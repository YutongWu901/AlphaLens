import { loadUniverse } from "./universe.js";
import { candidatePanel } from "./screening.js";
import { ic, esc, num, pct, clr, spark, plot, gauge } from "./graphics.js";
import { createEngine, FACTOR_INFO, DEFAULT_WEIGHTS } from "./quant.js";
import { renderResearch } from "./research.js";
const labels = {
  overview: "市场总览",
  scan: "多因子选股",
  target: "错杀识别",
  watch: "自选观察",
  regime: "市场状态",
  research: "因子研究",
  backtest: "策略回测",
  ml: "机器学习",
  simulation: "蒙特卡洛模拟",
  portfolio: "投资组合",
  data: "数据工作台",
};
const factors = {
  value: "价值",
  growth: "成长",
  quality: "企业质量",
  momentum: "动量",
  reversal: "超跌反转",
  sentiment: "市场情绪",
  earnings: "盈利预期",
  risk: "财务风险",
};
const defaults = DEFAULT_WEIGHTS;
const groups = [
  ["工作台", ["overview", "scan", "target", "watch"]],
  ["量化研究", ["research", "backtest", "ml", "simulation"]],
  ["资产与风险", ["portfolio", "regime"]],
];
const pools = {
  sample: "研究样本池",
  sp500: "标普 500",
  nasdaq100: "纳斯达克 100",
  mag7: "2024 冻结七股",
  custom: "自定义股票池",
  fav: "自选观察池",
};
const sectors = {
  "Information Technology": "信息技术",
  Technology: "信息技术",
  Financials: "金融",
  "Financial Services": "金融",
  "Health Care": "医疗保健",
  Healthcare: "医疗保健",
  "Consumer Discretionary": "可选消费",
  "Consumer Cyclical": "可选消费",
  "Consumer Staples": "必需消费",
  "Consumer Defensive": "必需消费",
  "Communication Services": "通信服务",
  Industrials: "工业",
  Energy: "能源",
  Utilities: "公用事业",
  "Real Estate": "房地产",
  Materials: "原材料",
  "Basic Materials": "原材料",
};
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  dialog = $("#dialog");
const read = (key, d) => {
  try {
    return JSON.parse(localStorage.getItem("alphalens." + key)) ?? d;
  } catch {
    return d;
  }
};
function save(k, v) {
  try {
    localStorage.setItem("alphalens." + k, JSON.stringify(v));
  } catch {
    toast("浏览器无法保存本地设置");
  }
}
let data,
  engine,
  view = "overview",
  pool = read("pool", "sample"),
  weights = read("weights", defaults),
  custom = read("custom", []),
  favorites = read("favorites", []),
  period = "6M",
  page = 0,
  query = "",
  sort = "score",
  industry = "",
  local = false,
  resizeFn = null,
  rankCache = null;
let dataToken,
  jobTimer,
  baseData,
  poolNotice = "";
async function hydrate(names = []) {
  const base = baseData;
  const wanted = new Set(["sp500", "nasdaq100"].includes(pool) ? [pool] : []);
  for (const s of names) {
    if (base.assets[s]) continue;
    if (base.universes.nasdaq100.includes(s)) wanted.add("nasdaq100");
    else if (base.universes.sp500.includes(s)) wanted.add("sp500");
  }
  for (const key of wanted) {
    try {
      const result = await loadUniverse(base, key);
      if (base !== baseData) return;
      const newIssues = result.issues.filter((v) => !base.issues.includes(v));
      base.issues.push(...newIssues);
      if (result.loaded) {
        data = { ...base };
        engine = createEngine(data);
        rankCache = null;
      }
      if (pool === key)
        poolNotice = result.missing.length
          ? "同期可用 " + result.covered + " / " + result.total + " 只，缺失证券已从排名中排除。"
          : "";
    } catch (e) {
      if (pool === key) poolNotice = e.message;
    }
  }
}
async function pickPool(value) {
  pool = value;
  save("pool", pool);
  page = 0;
  industry = "";
  rankCache = null;
  poolNotice = "";
  if (["sp500", "nasdaq100"].includes(pool)) {
    app.innerHTML =
      '<div class="loading"><span class="spinner"></span>正在载入' + esc(pools[pool]) + "的行情与财报…</div>";
    await hydrate();
  } else await hydrate(pool === "custom" ? custom : pool === "fav" ? favorites : []);
  if (pool !== value) return;
  render();
  if (pool === "custom" && !custom.length) customDialog();
}
const universe = () => (pool === "fav" ? favorites : pool === "custom" ? custom : data.universes[pool] || []);
const symbols = () =>
  universe().filter((s) => data.assets[s]?.type === "stock" && data.assets[s].prices?.length);
const stockCount = () => Object.values(data.assets).filter((a) => a.type === "stock").length;
const ranked = () => (rankCache ??= engine.rank({ symbols: symbols(), weights, afterClose: true }));
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = "none"), 3200);
}
function exportCSV(filename, rows) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (typeof v === "string" && /^[=+@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const blob = new Blob(["\ufeff" + rows.map((row) => row.map(cell).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
const button = (act, label, icon, primary = false) =>
  '<button class="btn' +
  (primary ? " primary" : "") +
  '" data-action="' +
  act +
  '">' +
  (icon ? ic(icon) : "") +
  label +
  "</button>";
function head(title, sub, tools = "") {
  return (
    '<div class="page-head"><div><h1>' +
    title +
    "</h1><p>" +
    sub +
    '</p></div><div class="tools">' +
    tools +
    "</div></div>"
  );
}
const title = (text, icon) => '<div class="area-title">' + ic(icon) + "<h2>" + text + "</h2></div>";
const tabs = (items, current, attr) =>
  '<div class="tabs">' +
  items
    .map(
      (v) =>
        '<button class="tab ' + (v === current ? "on" : "") + '" ' + attr + '="' + v + '">' + v + "</button>",
    )
    .join("") +
  "</div>";
function nav() {
  document.querySelector("#navigation").innerHTML = groups
    .map(
      ([g, vs]) =>
        '<div class="nav-label">' +
        g +
        "</div>" +
        vs
          .map(
            (v) =>
              '<button title="' +
              labels[v] +
              '" class="nav-btn ' +
              (view === v ? "active" : "") +
              '" data-nav="' +
              v +
              '">' +
              ic(v) +
              "<span>" +
              labels[v] +
              "</span></button>",
          )
          .join(""),
    )
    .join("");
  $("#crumb").textContent = labels[view];
  $("#sourceLink").onclick = () => go("data");
}
function go(v, changeHash = true) {
  if (!labels[v]) v = "overview";
  view = v;
  page = 0;
  query = "";
  industry = "";
  sort = "score";
  resizeFn = null;
  $("#sidebar").classList.remove("open");
  if (changeHash && location.hash.slice(1) !== v) history.pushState(null, "", "#" + v);
  if (dialog.open) dialog.close();
  nav();
  render();
  scrollTo(0, 0);
}
function datesLabel() {
  return "行情截至 " + esc(data.asOf) + " · 美国东部时间";
}
function poolSel() {
  return (
    '<select class="sel" id="pool" aria-label="研究股票池">' +
    Object.entries(pools)
      .map(([k, v]) => '<option value="' + k + '" ' + (pool === k ? "selected" : "") + ">" + v + "</option>")
      .join("") +
    "</select>"
  );
}
function dot(v) {
  return '<span class="ldot" style="background:' + v + '"></span>';
}
const periodN = { "1M": 22, "3M": 64, "6M": 127, "1Y": 253, "3Y": 757 };
const bench = [
  ["SPY", "#b695ff"],
  ["QQQ", "#55d2ba"],
  ["DIA", "#79a8ed"],
];
function marketPlot() {
  const el = $("#marketPlot");
  if (!el) return;
  const arr = bench.map(([s, color]) => ({
    name: s,
    color,
    rows: (data.assets[s]?.prices || []).slice(-periodN[period]).map((p) => [p[0], p[1]]),
  }));
  plot(el, arr);
  $("#marketLegend").innerHTML = arr
    .map(
      (s) =>
        "<span>" +
        dot(s.color) +
        s.name +
        '<b style="color:' +
        s.color +
        '">' +
        pct(s.rows.at(-1)?.[1] / s.rows[0]?.[1] - 1, 1) +
        "</b></span>",
    )
    .join("");
  resizeFn = marketPlot;
}
function indexCard(name, s, fall, code) {
  const asset = data.assets[s] || data.assets[fall];
  const prices = asset?.prices || [],
    last = prices.at(-1),
    prev = prices.at(-2),
    v = last?.[2] ?? last?.[1],
    ch = v / (prev?.[2] ?? prev?.[1]) - 1;
  return (
    '<div class="card kpi"><div class="kpi-title">' +
    esc(asset?.type === "etf" ? fall + " ETF" : name) +
    '<span class="symbol-tag">' +
    esc(asset?.type === "etf" ? fall : code) +
    '</span></div><div class="big">' +
    num(v) +
    '</div><span title="' +
    esc(last?.[0]) +
    '" class="delta ' +
    clr(ch) +
    '">' +
    (ch > 0 ? "▴ " : ch < 0 ? "▾ " : "") +
    pct(ch) +
    "</span><small>日涨跌</small>" +
    spark(
      prices.slice(-36).map((p) => p[2] ?? p[1]),
      ch >= 0 ? "#62dbb8" : "#ed8096",
      108,
      42,
      true,
    ) +
    "</div>"
  );
}
function marketCard() {
  return (
    '<section class="card panel"><div class="panel-head">' +
    title("市场基准走势", "chart") +
    tabs(["1M", "3M", "6M", "1Y", "3Y"], period, "data-period") +
    '</div><div class="legend" id="marketLegend"></div><div id="marketPlot" class="chart-frame"></div><div class="chart-note">区间累计收益 · 复权收盘价</div></section>'
  );
}
function regimeCard() {
  const r = engine.regime(data.asOf),
    a = data.assets.SPY?.prices.at(-1),
    rr = ranked().filter((x) => Number.isFinite(x.change)),
    up = rr.filter((x) => x.change > 0).length;
  return (
    '<section class="card panel regime"><div class="panel-head">' +
    title("市场状态", "regime") +
    '<span class="pill">SPY 模型</span></div>' +
    gauge(r.key, r.name) +
    '<div class="regime-list"><div class="mini-row"><span>年化波动率</span><b>' +
    pct(r.volatility, 1, false) +
    '</b></div><div class="mini-row"><span>近 63 日收益</span><b class="' +
    clr(r.change63) +
    '">' +
    pct(r.change63) +
    '</b></div><div class="mini-row"><span>研究池上涨家数</span><b>' +
    up +
    " / " +
    rr.length +
    '</b></div></div><div class="regime-foot"><span>' +
    esc(a?.[0]) +
    ' 收盘</span><button class="linkbtn" data-nav="regime">查看模型 ' +
    ic("right") +
    "</button></div></section>"
  );
}
function mono(symbol) {
  const palettes = [
    ["#35304e", "#d6c1ff"],
    ["#243f36", "#9be2ba"],
    ["#2a3851", "#a6cafa"],
    ["#463337", "#f3b7af"],
    ["#3c3829", "#f4d897"],
    ["#303949", "#bfcfec"],
  ];
  const [bg, fg] = palettes[[...symbol].reduce((s, c) => s + c.charCodeAt(0), 0) % palettes.length];
  return (
    '<span class="monogram" style="background:' +
    bg +
    ";color:" +
    fg +
    '">' +
    esc(symbol.slice(0, 2)) +
    "</span>"
  );
}
function stockRow(r, i) {
  const p = data.assets[r.symbol]?.prices || [],
    s = esc(r.symbol),
    trend = p.slice(-22).map((v) => v[1]);
  return (
    '<tr class="stock-row" tabindex="0" data-stock="' +
    s +
    '"><td class="rank-no">' +
    String(i + 1).padStart(2, "0") +
    '</td><td><div class="ticker-cell">' +
    mono(r.symbol) +
    "<div><b>" +
    s +
    '</b><small title="' +
    esc(r.name) +
    '">' +
    esc(r.name) +
    '</small></div></div></td><td><span class="sector-tag">' +
    esc(sectors[r.sector] || r.sector || "未分类") +
    '</span></td><td class="num">' +
    num(r.price) +
    '</td><td class="num ' +
    clr(r.change) +
    '">' +
    pct(r.change) +
    '</td><td><span class="score">' +
    num(r.score, 1) +
    '<span class="track"><i style="width:' +
    (r.score || 0) +
    '%"></i></span></span></td><td><div style="width:76px;height:25px">' +
    spark(trend, trend.at(-1) >= trend[0] ? "#57ccad" : "#e68297", 76, 25) +
    '</div></td><td><button class="star ' +
    (favorites.includes(r.symbol) ? "saved" : "") +
    '" data-star="' +
    s +
    '" title="切换自选" aria-label="切换 ' +
    s +
    ' 自选">' +
    ic("watch") +
    "</button></td></tr>"
  );
}
function relevantRows() {
  let r = view === "watch" ? rankedFav() : ranked();
  if (view === "target") r = r.filter((s) => s.watch === true);
  return r
    .filter(
      (s) =>
        (!industry || s.sector === industry) &&
        (!query || (s.symbol + " " + s.name).toLowerCase().includes(query.toLowerCase())),
    )
    .slice()
    .sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity));
}
function rankedFav() {
  return engine
    .rank({ symbols: [...new Set([...symbols(), ...favorites])], weights, afterClose: true })
    .filter((r) => favorites.includes(r.symbol));
}
function tableBody(home = false) {
  const rows = relevantRows(),
    per = home ? 6 : 18;
  page = Math.max(0, Math.min(page, Math.ceil(rows.length / per) - 1));
  const shown = rows.slice(page * per, (page + 1) * per);
  return (
    '<div class="table-scroll"><table><thead><tr>' +
    ["排名", "股票 / 公司", "行业", "收盘价 ($)", "日涨跌", "综合评分", "近月走势", "自选"]
      .map((v) => "<th>" + v + "</th>")
      .join("") +
    "</tr></thead><tbody>" +
    shown.map((r, i) => stockRow(r, i + page * per)).join("") +
    "</tbody></table></div>" +
    (!rows.length
      ? '<div class="empty">' +
        (view === "watch"
          ? "点击股票行末的星标，将公司加入自选观察。"
          : view === "target"
            ? "当前股票池没有同时通过全部条件的公司。可在个股详情中查看筛查依据。"
            : "没有匹配的股票。请调整筛选条件或股票池。") +
        "</div>"
      : "") +
    '<div class="table-foot"><span>' +
    esc(view === "watch" ? "自选观察" : pools[pool]) +
    " · " +
    rows.length +
    " 只" +
    (home ? " · 按综合评分排序" : "") +
    "</span>" +
    (home
      ? '<button class="linkbtn" data-nav="scan">完整排名 ' + ic("right") + "</button>"
      : '<span><button class="chip" data-page="-1" ' +
        (page === 0 ? "disabled" : "") +
        ">上一页</button> " +
        (rows.length ? page + 1 : 0) +
        " / " +
        Math.ceil(rows.length / per) +
        ' <button class="chip" data-page="1" ' +
        ((page + 1) * per >= rows.length ? "disabled" : "") +
        ">下一页</button></span>") +
    "</div>"
  );
}
function dashboard() {
  app.innerHTML =
    head(
      "市场总览",
      "收盘研究快照 · " + symbols().length + " 只股票 · 八因子评分",
      '<span class="btn" title="最新行情日期">' +
        ic("calendar") +
        esc(data.asOf) +
        "</span>" +
        button("export", "导出排名", "download", true),
    ) +
    '<div class="grid-kpi">' +
    indexCard("标普 500", "^GSPC", "SPY", "SPX") +
    indexCard("纳斯达克 100", "^NDX", "QQQ", "NDX") +
    indexCard("道琼斯工业", "^DJI", "DIA", "DJI") +
    indexCard("波动率指数", "^VIX", "^VIX", "VIX") +
    '</div><div class="hero-grid">' +
    marketCard() +
    regimeCard() +
    '</div><section class="card rank-box"><div class="panel-head">' +
    title("多因子机会排名", "layers") +
    '<div class="tools">' +
    poolSel() +
    button("weights", "因子权重", "sliders") +
    '</div></div><div id="table">' +
    tableBody(true) +
    "</div></section>";
  marketPlot();
}
function scanner() {
  let subtitle =
    view === "watch"
      ? "跟踪已收藏的公司，使用当前研究池作为评分参照。"
      : view === "target"
        ? "筛查大幅回撤、估值合理且盈利韧性较强的公司。"
        : "按因子组合比较股票，点击公司查看原始指标和评分依据。";
  app.innerHTML =
    head(
      labels[view],
      subtitle,
      button("weights", "因子权重", "sliders") + button("export", "导出排名", "download", true),
    ) +
    '<section class="card rank-box"><div class="filters">' +
    poolSel() +
    button("custom", "编辑自定义池", "list") +
    '<input id="filterQuery" type="search" placeholder="搜索代码或公司" aria-label="筛选股票" value="' +
    esc(query) +
    '"><select id="industry" aria-label="行业"><option value="">全部行业</option>' +
    [...new Set((view === "watch" ? rankedFav() : ranked()).map((r) => r.sector).filter(Boolean))]
      .sort()
      .map(
        (s) =>
          '<option value="' +
          esc(s) +
          '" ' +
          (industry === s ? "selected" : "") +
          ">" +
          esc(sectors[s] || s) +
          "</option>",
      )
      .join("") +
    '</select><select id="sort" aria-label="排序">' +
    Object.entries({ score: "综合评分 ↓", change: "日涨跌 ↓", price: "收盘价 ↓" })
      .map(([k, v]) => '<option value="' + k + '" ' + (sort === k ? "selected" : "") + ">" + v + "</option>")
      .join("") +
    '</select></div><div id="table">' +
    tableBody() +
    '</div></section><p class="note" style="margin-top:12px">' +
    coverageText() +
    "</p>" +
    (view === "target"
      ? '<div class="card panel" style="margin-top:15px">' +
        title("判读依据", "info") +
        '<p class="note" style="margin-top:8px">详情中列出估值、盈利质量、预期修订与回撤证据。财报披露时间与预期快照日期分别记录，证据不足时保留待核验状态。</p></div>'
      : "");
}
function coverageText() {
  return (
    (poolNotice ? esc(poolNotice) + " " : "") +
    esc(pools[pool]) +
    "已载入 " +
    symbols().length +
    " / " +
    universe().length +
    " 只股票。评分是所选横截面中的相对位置。缺失指标的处理见个股详情。"
  );
}
function render() {
  if (!data) return;
  resizeFn = null;
  if (view === "overview") dashboard();
  else if (["scan", "target", "watch"].includes(view)) scanner();
  else if (view === "regime") regimes();
  else if (view === "data") sources();
  else {
    app.innerHTML =
      '<div class="tools" style="justify-content:flex-end;margin-bottom:12px">' +
      poolSel() +
      button("weights", "因子权重", "sliders") +
      '</div><div id="studyRoot"></div>';
    renderResearch(view, $("#studyRoot"), {
      engine,
      data,
      weights,
      symbols: symbols(),
      pool,
      openStock,
      exportCSV,
      chart: plot,
    });
  }
  if (view === "target") app.insertAdjacentHTML("beforeend", candidatePanel(ranked()));
  if (poolNotice && view !== "scan" && view !== "target")
    app.insertAdjacentHTML("afterbegin", '<p class="insight">' + esc(poolNotice) + "</p>");
}
function regimes() {
  const r = engine.regime(data.asOf);
  app.innerHTML =
    head("市场状态识别", datesLabel(), button("research", "查看因子研究", "research")) +
    '<div class="hero-grid">' +
    marketCard() +
    regimeCard() +
    '</div><section class="card panel">' +
    title("模型判定依据", "info") +
    '<p class="insight">' +
    esc(r.explanation) +
    '</p><div class="mini-row"><span>SPY 200 日均价 · 复权美元</span><b>' +
    num(r.ma200) +
    '</b></div><p class="note">分类依据 SPY 趋势与已实现波动率。各环境下的因子表现可在因子研究中按历史状态检验。</p></section>';
  marketPlot();
}
function modal(headText, body, wide = false) {
  if (dialog.open) dialog.close();
  dialog.className = wide ? "wide" : "";
  dialog.innerHTML =
    '<div class="dialog-head"><h2>' +
    headText +
    '</h2><button class="close" aria-label="关闭" data-action="close">×</button></div><div class="dialog-body">' +
    body +
    "</div>";
  dialog.showModal();
}
function weightDialog() {
  modal(
    "自定义因子权重",
    '<p class="note">权重按比例归一化，设为 0 表示关闭该因子。有效权重不足一半时保留空分。</p>' +
      Object.entries(factors)
        .map(
          ([k, l]) =>
            '<label class="weight-row"><span>' +
            l +
            '</span><input data-weight="' +
            k +
            '" type="range" min="0" max="100" step="1" value="' +
            (weights[k] ?? 0) +
            '"><output>' +
            num(weights[k], 0) +
            "</output></label>",
        )
        .join("") +
      '<div class="dialog-actions">' +
      button("weightReset", "恢复默认") +
      button("weightSave", "应用权重", null, true) +
      "</div>",
  );
}
function customDialog() {
  modal(
    "自定义股票池",
    '<p class="note">输入美股代码，以逗号或空格分隔。已下载的股票可立即加入。</p><textarea id="customSymbols" class="full" rows="4" style="margin-top:12px" placeholder="AAPL, MSFT, JPM">' +
      esc(custom.join(", ")) +
      '</textarea><p id="customMsg" class="note"></p><div class="dialog-actions">' +
      button("customSave", "保存股票池", null, true) +
      "</div>",
  );
}
function searchDialog() {
  modal(
    "搜索股票",
    '<input id="stockSearch" class="full" placeholder="输入股票代码或公司名" autocomplete="off" aria-label="搜索所有已下载股票"><div class="search-list" id="searchResults"></div>',
  );
  searchResults("");
  $("#stockSearch").focus();
}
function searchResults(q) {
  const unobserved = q.trim()
    ? Array.from(new Set([...data.universes.sp500, ...data.universes.nasdaq100]))
        .filter((s) => !data.assets[s] && s.startsWith(q.toUpperCase().trim()))
        .map((symbol) => ({ symbol, name: "指数成分 · 点击载入", type: "stock" }))
    : [];
  const rows = [...Object.values(data.assets), ...unobserved]
    .filter((a) => a.type === "stock" && (a.symbol + " " + a.name).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .slice(0, 60);
  $("#searchResults").innerHTML =
    rows
      .map(
        (a) =>
          '<button class="search-item" data-stock="' +
          esc(a.symbol) +
          '"><span><b>' +
          esc(a.symbol) +
          "</b>　" +
          esc(a.name) +
          "</span><small>" +
          esc(sectors[a.sector] || a.sector || "") +
          "</small></button>",
      )
      .join("") || '<div class="empty">没有找到该公司</div>';
}
const safeDate = (v) => (/^\d{4}-\d\d-\d\d/.test(v || "") ? String(v).slice(0, 10) : "—");
function openStock(s) {
  const sy = [...new Set([...symbols(), s])];
  const r = engine.stock(s, { symbols: sy, weights, afterClose: true }),
    a = data.assets[s];
  if (!a || !r) return;
  const val = r.valuation || {},
    p = a.prices || [],
    f = r.fundamental || {},
    e = r.estimate || {};
  const list = (arr) =>
    '<ul class="bullet-list">' +
    (arr?.length ? arr : ["证据不足，暂无可列示项目。"]).map((x) => "<li>" + esc(x) + "</li>").join("") +
    "</ul>";
  modal(
    esc(s) + "　" + esc(a.name),
    '<div class="summary-line"><strong class="ticker-big">$' +
      num(r.price) +
      '</strong><b class="' +
      clr(r.change) +
      '">' +
      pct(r.change) +
      '</b><span class="sector-tag">' +
      esc(sectors[r.sector] || r.sector) +
      '</span><span class="pill">' +
      safeDate(p.at(-1)?.[0]) +
      '</span><button class="chip" data-detail-star="' +
      esc(s) +
      '">' +
      ic("watch") +
      (favorites.includes(s) ? "已加入自选" : "加入自选") +
      '</button></div><div id="stockPlot" class="chart-frame" style="height:160px"></div><p class="chart-note">过去一年复权收盘价 · 美元</p><div class="info-grid" style="margin-top:16px"><section class="card panel">' +
      title("综合评分　" + num(r.score, 1), "layers") +
      '<div class="metric-list">' +
      Object.entries(factors)
        .map(
          ([k, l]) =>
            '<div class="metric-line"><span>' +
            l +
            '</span><span class="track"><i style="width:' +
            (r.factors?.[k] || 0) +
            '%"></i></span><span class="num">' +
            num(r.factors?.[k], 1) +
            "</span></div>",
        )
        .join("") +
      '</div></section><section class="card panel">' +
      title("历史相对估值", "chart") +
      [
        ["当前市盈率", num(val.pe, 1) + " ×"],
        ["历史分位（10% / 90%）", num(val.low, 1) + " / " + num(val.high, 1)],
        ["历史中位市盈率", num(val.median, 1) + " ×"],
        ["中位数情景价格", "$" + num(val.target)],
        ["估值修复空间", pct(val.upside)],
        ["有效历史估值样本", num(val.n, 0)],
      ]
        .map(([a, b]) => '<div class="mini-row"><span>' + a + "</span><b>" + b + "</b></div>")
        .join("") +
      '<p class="note">情景价格假定盈利不变、市盈率回归历史中位数。</p></section></div><div class="info-grid" style="margin-top:12px"><section><h3>投资优势</h3>' +
      list(r.strengths) +
      "</section><section><h3>主要风险</h3>" +
      list(r.risks) +
      '</section></div><div class="insight">' +
      esc(r.watchReason || "错杀识别证据不足") +
      '</div><details><summary>原始因子与数据依据</summary><div class="metric-list">' +
      Object.entries(r.raw || {})
        .map(
          ([k, v]) =>
            '<div class="mini-row"><span>' +
            esc(factors[k] || k) +
            '<small style="display:block;color:var(--faint)">' +
            esc(FACTOR_INFO[k]?.[1] || "") +
            "</small></span><b>" +
            pct(v, 2, false) +
            "</b></div>",
        )
        .join("") +
      '</div><p class="note">可用权重覆盖 ' +
      pct(r.coverage, 0, false) +
      " · 财报披露 " +
      safeDate(f.filed) +
      " · 报告期末 " +
      safeDate(f.periodEnd) +
      " · 一致预期快照 " +
      safeDate(e.asOf) +
      "。横截面比较池 " +
      sy.length +
      ' 只，当前池外股票在查看时加入参照池。</p><p class="note">年度营收 $' +
      num(f.revenue == null ? null : f.revenue / 1e9, 2) +
      " B · 净利润 $" +
      num(f.netIncome == null ? null : f.netIncome / 1e9, 2) +
      " B · 同口径预期 EPS $" +
      num(e.forwardEPS) +
      " · 30 日前 $" +
      num(e.previousForwardEPS) +
      '</p><p class="note"><a href="https://finance.yahoo.com/quote/' +
      encodeURIComponent(s) +
      '/history/" target="_blank" rel="noopener">行情来源</a>　<a href="https://finance.yahoo.com/quote/' +
      encodeURIComponent(s) +
      '/analysis/" target="_blank" rel="noopener">预期来源</a>' +
      (f.accession && a.cik
        ? '　<a href="https://www.sec.gov/Archives/edgar/data/' +
          Number(a.cik) +
          "/" +
          String(f.accession).replaceAll("-", "") +
          "/" +
          esc(f.accession) +
          '-index.htm" target="_blank" rel="noopener">原始 10-K</a>'
        : "") +
      "</p></details>",
    true,
  );
  plot($("#stockPlot"), [{ name: s, color: "#b695ff", rows: p.slice(-253).map((x) => [x[0], x[1]]) }], {
    percent: false,
    digits: 2,
  });
}

const srcNames = {
  prices: "Yahoo Finance · 每日收盘",
  financials: "SEC EDGAR · 原始 10-K",
  estimates: "Yahoo Finance · 分析师一致预期",
  macro: "FRED · 利率与波动率",
  sp500: "标普 500 · 成分证券名单",
  nasdaq100: "纳斯达克 100 · 成分证券名单",
  mag7: "Roundhill · 冻结股票池依据",
};
function sources() {
  const a = Object.values(data.assets).filter((x) => x.type === "stock"),
    coverage = a.filter((s) => s.fundamentals?.length).length;
  const sourceRows = Object.entries(data.sources)
    .map(
      ([k, url]) =>
        '<div class="source-row"><span>' +
        esc(srcNames[k] || k) +
        '</span><a href="' +
        esc(url) +
        '" target="_blank" rel="noopener noreferrer">查看来源 ↗</a></div>',
    )
    .join("");
  app.innerHTML =
    head(
      "数据工作台",
      "查看快照日期、来源、覆盖情况及缺失记录。",
      button("reload", "重新加载快照", "refresh"),
    ) +
    '<div class="info-grid"><section class="card panel">' +
    title("数据覆盖", "data") +
    '<div class="metric-list">' +
    [
      ["美国收盘日", data.asOf],
      ["历史价格覆盖", a.length + " 只股票"],
      ["原始年度财报", coverage + " 只股票"],
      ["已观察的一致预期", a.filter((s) => s.estimates?.length).length + " 只股票"],
      [
        "标普 500 · 当前已载入",
        data.universes.sp500.filter((s) => data.assets[s]).length + " / " + data.universes.sp500.length,
      ],
      [
        "纳斯达克 100 · 当前已载入",
        data.universes.nasdaq100.filter((s) => data.assets[s]).length +
          " / " +
          data.universes.nasdaq100.length,
      ],
      [
        "快照生成时间",
        new Date(data.generatedAt).toLocaleString("zh-CN", { timeZone: "America/New_York", hour12: false }) +
          " ET",
      ],
    ]
      .map(([k, v]) => '<div class="mini-row"><span>' + k + "</span><b>" + esc(v) + "</b></div>")
      .join("") +
    '</div></section><section class="card panel">' +
    title("数据来源", "globe") +
    sourceRows +
    '</section><section class="card panel">' +
    title("宏观观测", "regime") +
    Object.entries(data.macro || {})
      .map(([k, rows]) => {
        const last = rows.at(-1);
        return (
          '<div class="source-row"><span>' +
          esc(
            { DGS10: "美国 10 年期国债收益率", DGS2: "美国 2 年期国债收益率", VIXCLS: "CBOE VIX 收盘指数" }[
              k
            ] || k,
          ) +
          '<small style="display:block">' +
          safeDate(last?.[0]) +
          '</small></span><b class="num">' +
          num(last?.[1]) +
          (k.startsWith("DGS") ? "%" : "") +
          "</b></div>"
        );
      })
      .join("") +
    '<p class="note">采用 FRED 当前版本观测，作市场背景展示。</p></section><section class="card panel">' +
    title("行情与财报同步", "refresh") +
    '<p class="note" style="margin:12px 0">' +
    (local
      ? "本地服务在运行期间每日美东收盘后检查更新。可手动扩展到完整指数池，下载期间仍可使用原快照。"
      : "此在线版本使用发布时的研究快照。本地版可从原始数据源同步，并扩展至完整指数成分和自定义股票。") +
    "</p>" +
    (local
      ? '<select id="refreshPool" class="sel" aria-label="同步范围"><option value="saved">已下载股票</option><option value="sp500">标普 500 全部成分</option><option value="nasdaq100">纳斯达克 100 全部成分</option><option value="all">两指数全部成分</option></select> ' +
        button("refresh", "开始同步", "refresh")
      : "<code>python refresh.py --universe all</code>") +
    '<p class="note" id="jobState" style="margin-top:12px"></p></section></div><section class="card panel" style="margin-top:15px">' +
    title("可解释性与数据质量", "info") +
    '<div class="insight">八项因子按同日可用股票的百分位排名。有效因子覆盖权重达到 50% 才输出综合分，并按可用权重归一化。收益与动量使用复权价，估值使用同拆股口径的股价和年度稀释 EPS。</div>' +
    Object.entries(FACTOR_INFO)
      .map(
        ([k, [l, formula]]) =>
          '<div class="source-row"><b>' + esc(l) + "</b><span>" + esc(formula) + "</span></div>",
      )
      .join("") +
    '<details style="margin-top:12px"><summary>采集异常与缺失记录（' +
    data.issues.length +
    "）</summary>" +
    data.issues.map((v) => '<p class="note">' + esc(v) + "</p>").join("") +
    "</details></section>";
  if (local) checkJob();
}
async function checkJob() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) return;
    const j = await res.json();
    const el = $("#jobState");
    if (el) el.textContent = j.message || "数据服务就绪。";
    if (j.running) {
      clearTimeout(jobTimer);
      jobTimer = setTimeout(checkJob, 2600);
    } else if (dataToken && j.updated && dataToken !== j.updated) {
      await loadData();
      render();
    }
    dataToken = j.updated;
  } catch {}
}
async function requestRefresh(universe, extra = []) {
  try {
    const res = await fetch("/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ universe, symbols: extra }),
    });
    const j = await res.json();
    if (!res.ok) throw Error(j.message || "无法开始同步");
    toast(j.message);
    await checkJob();
  } catch (e) {
    toast(e.message);
  }
}
function toggleStar(s) {
  favorites = favorites.includes(s) ? favorites.filter((x) => x !== s) : [...favorites, s];
  save("favorites", favorites);
  rankCache = null;
}
function exportRows() {
  const rs = relevantRows();
  exportCSV("AlphaLens-" + data.asOf + "-" + pool, [
    [
      "日期",
      "代码",
      "公司",
      "行业",
      "股票池",
      "收盘价USD",
      "复权日收益率",
      "综合评分",
      "可用权重覆盖",
      ...Object.values(factors),
      ...Object.keys(factors).map((k) => factors[k] + "权重"),
    ],
    ...rs.map((r) => [
      r.date,
      r.symbol,
      r.name,
      r.sector,
      pools[pool],
      r.price,
      r.change,
      r.score,
      r.coverage,
      ...Object.keys(factors).map((k) => r.factors[k]),
      ...Object.keys(factors).map((k) => weights[k]),
    ]),
  ]);
  toast("已导出 " + rs.length + " 只股票的评分与权重");
}
async function act(k) {
  if (k === "search") searchDialog();
  else if (k === "weights") weightDialog();
  else if (k === "close") dialog.close();
  else if (k === "custom") customDialog();
  else if (k === "research") go("research");
  else if (k === "export") exportRows();
  else if (k === "weightReset") {
    dialog.querySelectorAll("[data-weight]").forEach((el) => {
      el.value = defaults[el.dataset.weight];
      el.nextElementSibling.value = el.value;
    });
  } else if (k === "weightSave") {
    const vals = Object.fromEntries(
      [...dialog.querySelectorAll("[data-weight]")].map((el) => [el.dataset.weight, +el.value]),
    );
    if (!Object.values(vals).some((v) => v > 0)) return toast("请至少启用一个因子");
    weights = vals;
    save("weights", vals);
    rankCache = null;
    dialog.close();
    render();
    toast("已应用因子权重");
  } else if (k === "customSave") {
    const raw = $("#customSymbols")
        .value.toUpperCase()
        .replaceAll(".", "-")
        .split(/[\s,，;；]+/)
        .filter(Boolean),
      sy = [...new Set(raw)],
      unknownBefore = sy.filter((s) => data.assets[s]?.type !== "stock");
    if (unknownBefore.length) await hydrate(unknownBefore);
    const unknown = sy.filter((s) => data.assets[s]?.type !== "stock");
    if (unknown.length) {
      $("#customMsg").textContent =
        "尚未下载或无法识别的代码：" +
        unknown.join(", ") +
        "。" +
        (local ? "可同步后再次保存。" : "可用本地同步器下载。");
      if ($("#fetchCustom")) $("#fetchCustom").remove();
      if (local) {
        const b = document.createElement("button");
        b.id = "fetchCustom";
        b.className = "btn";
        b.textContent = "同步缺少的股票";
        b.onclick = () => requestRefresh("saved", unknown);
        $("#customMsg").after(b);
      }
      return;
    }
    if (!sy.length) return toast("请至少输入一个股票代码");
    custom = sy;
    save("custom", sy);
    pool = "custom";
    save("pool", pool);
    rankCache = null;
    dialog.close();
    go("scan");
  } else if (k === "reload") {
    await loadData();
    render();
    toast("快照已加载");
  } else if (k === "refresh") await requestRefresh($("#refreshPool").value);
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("button,[data-stock]");
  if (!el) return;
  try {
    if (el.dataset.star) {
      toggleStar(el.dataset.star);
      render();
    } else if (el.dataset.detailStar) {
      toggleStar(el.dataset.detailStar);
      openStock(el.dataset.detailStar);
      if ($("#table")) $("#table").innerHTML = tableBody(view === "overview");
    } else if (el.dataset.stock) {
      const sym = el.dataset.stock;
      if (data.assets[sym]) openStock(sym);
      else
        hydrate([sym])
          .then(() => {
            if (data.assets[sym]) openStock(sym);
            else toast("该证券的指数扩展数据尚不可用");
          })
          .catch((err) => toast(err.message));
    } else if (el.dataset.nav) go(el.dataset.nav);
    else if (el.dataset.period) {
      period = el.dataset.period;
      render();
    } else if (el.dataset.page) {
      page += Number(el.dataset.page);
      $("#table").innerHTML = tableBody();
    } else if (el.dataset.action) act(el.dataset.action).catch((err) => toast(err.message));
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.weight) el.nextElementSibling.value = el.value;
  if (el.id === "stockSearch") searchResults(el.value);
  if (el.id === "filterQuery") {
    query = el.value;
    page = 0;
    $("#table").innerHTML = tableBody();
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "pool") {
    pickPool(el.value).catch((e) => toast(e.message));
  } else if (el.id === "industry" || el.id === "sort") {
    if (el.id === "industry") industry = el.value;
    else sort = el.value;
    page = 0;
    $("#table").innerHTML = tableBody();
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (data) searchDialog();
  } else if (e.key === "Enter" && e.target.matches("tr[data-stock]")) openStock(e.target.dataset.stock);
});
$("#hamb").onclick = () => $("#sidebar").classList.toggle("open");
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#sidebar,#hamb")) $("#sidebar").classList.remove("open");
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog && e.offsetY < 0) dialog.close();
});
window.addEventListener("popstate", () => go(location.hash.slice(1), false));
let timer;
window.addEventListener("resize", () => {
  clearTimeout(timer);
  timer = setTimeout(() => resizeFn?.(), 130);
});
$(".homeicon").innerHTML = ic("overview");
$(".search-icon").innerHTML = ic("search");
async function loadData() {
  const res = await fetch("./data/market.json", { cache: "no-cache" });
  if (!res.ok) throw Error("行情快照读取失败（HTTP " + res.status + "）");
  const next = await res.json();
  const q = createEngine(next);
  data = next;
  baseData = next;
  engine = q;
  rankCache = null;
  if (!Object.hasOwn(pools, pool)) pool = "sample";
  let holdings = [];
  try {
    holdings = JSON.parse(localStorage.getItem("alphalens.portfolio.holdings.v1") || "[]").map(
      (h) => h.symbol,
    );
  } catch {}
  await hydrate([...favorites, ...custom, ...holdings]);
}
async function boot() {
  try {
    await loadData();
    go(location.hash.slice(1) || "overview", false);
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
      try {
        const r = await fetch("/api/status");
        if (r.ok) {
          const j = await r.json();
          local = j.service === "AlphaLens";
          dataToken = j.updated;
          if (view === "data") sources();
        }
      } catch {}
    }
  } catch (e) {
    app.innerHTML =
      '<div class="card empty">无法打开研究平台：' +
      esc(e.message) +
      '<br><button class="btn" onclick="location.reload()">重试</button></div>';
  }
}
boot();
