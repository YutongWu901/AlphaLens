const FACTORS = {
  value: "价值",
  growth: "成长",
  quality: "质量",
  momentum: "动量",
  reversal: "反转",
  sentiment: "市场情绪",
  earnings: "盈利预期",
  risk: "财务风险",
};
const factorKeys = Object.keys(FACTORS);
const COLORS = ["#55dfbf", "#aa94f9", "#6da9f1", "#eeb76d", "#f58eac", "#99c484", "#8096ba", "#e6aed6"];
const TITLES = {
  research: ["因子有效性研究", "检验因子排序与未来收益的关系，比较不同样本阶段及市场环境。"],
  backtest: ["策略回测", "按历史可得信息选股，比较扣除交易成本后的策略净值与基准表现。"],
  ml: ["机器学习研究", "以时间顺序滚动训练，观察因子组合在未参与训练的数据上的表现。"],
  simulation: ["蒙特卡洛模拟", "从历史联合收益中抽取连续区块，估计不同配置的收益分布与回撤风险。"],
  portfolio: ["投资组合管理", "录入实际持仓与现金，根据历史联合收益分析风险敞口和行业集中度。"],
};
const HOLDINGS_KEY = "alphalens.portfolio.holdings.v1";
const num = (value, digits = 2) =>
  Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
const pct = (value, digits = 2) => (Number.isFinite(value) ? num(value * 100, digits) + "%" : "—");
const cash = (value) => (Number.isFinite(value) ? "$" + num(value, 2) : "—");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const sign = (x) => (Number.isFinite(x) && x !== 0 ? (x > 0 ? "rv-up" : "rv-down") : "");
const select = (name, label, values, chosen) =>
  `<label class="rv-field"><span>${esc(label)}</span><select name="${name}">${values.map(([v, t]) => `<option value="${esc(v)}" ${String(chosen) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
const input = (name, label, value, options = "") =>
  `<label class="rv-field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${options}></label>`;
const table = (columns, rows) =>
  `<div class="rv-scroll"><table class="rv-table"><thead><tr>${columns.map((t) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((t) => `<td>${t}</td>`).join("")}</tr>`).join("")}</tbody></table>${rows.length ? "" : '<div class="rv-empty">此范围内没有可用观测。</div>'}</div>`;
const panel = (title, body, tools = "") =>
  `<section class="rv-panel"><div class="rv-panelhead"><h2>${esc(title)}</h2>${tools}</div>${body}</section>`;
const metrics = (items) =>
  `<div class="rv-metrics">${items.map(([title, value, note, cls = ""]) => `<div class="rv-metric"><div>${esc(title)}</div><strong class="${cls}">${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ""}</div>`).join("")}</div>`;
const methodology = (notes, warnings = []) =>
  `<details class="rv-method" ${warnings.length ? "open" : ""}><summary>数据口径与模型局限</summary>${[
    ...new Set([...warnings, ...notes]),
  ]
    .filter(Boolean)
    .map((x) => `<p>${esc(x)}</p>`)
    .join("")}</details>`;
const exportButton = (label = "导出 CSV") =>
  `<button type="button" class="rv-secondary rv-slim" data-export>${label}</button>`;
const fieldNumber = (name, label, value, min, max, step = 1) =>
  input(name, label, value, `type="number" min="${min}" max="${max}" step="${step}" required`);
const saveCSV = (ctx, filename, rows) => {
  if (ctx.exportCSV) return ctx.exportCSV(filename, rows);
  const url = URL.createObjectURL(
    new Blob(
      [
        "\ufeff",
        rows
          .map((row) => row.map((val) => '"' + String(val ?? "").replace(/"/g, '""') + '"').join(","))
          .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const signed = (v) => `<span class="${sign(v)}">${num(v, 3)}</span>`;
const dateLimits = (ctx) => {
  const dates = ctx.engine?.dates || (ctx.data.assets.SPY?.prices || []).map((x) => x[0]);
  return [dates[0] || "", dates.at(-1) || ctx.data.asOf];
};
const assetChoices = (ctx) =>
  Object.keys(ctx.data.assets)
    .filter((k) => ctx.data.assets[k].type !== "index")
    .sort()
    .map((s) => [s, s + " · " + (ctx.data.assets[s].name || s)]);
const readHoldings = () => {
  try {
    const h = JSON.parse(localStorage.getItem(HOLDINGS_KEY) || "[]");
    return Array.isArray(h)
      ? h.filter((x) => x && typeof x.symbol === "string" && Number.isFinite(x.shares) && x.shares > 0)
      : [];
  } catch {
    return [];
  }
};
let worker,
  workerDataset,
  taskSeq = 0;
const pending = new Map();
function engineCall(ctx, method, ...args) {
  if (typeof Worker === "undefined" || location.protocol === "file:")
    return Promise.resolve().then(() => ctx.engine[method](...args));
  if (!worker || workerDataset !== ctx.data) {
    if (worker) {
      worker.terminate();
      for (const req of pending.values()) req.reject(new Error("数据集已切换，请重新计算。"));
      pending.clear();
    }
    worker = new Worker(new URL("./research-worker.js", import.meta.url), { type: "module" });
    workerDataset = null;
    worker.onmessage = ({ data }) => {
      const req = pending.get(data.id);
      if (!req) return;
      pending.delete(data.id);
      if (data.error) req.reject(new Error(data.error));
      else req.resolve(data.result);
    };
    worker.onerror = () => {
      worker.terminate();
      worker = null;
      workerDataset = null;
      for (const req of pending.values()) {
        try {
          req.resolve(req.fallback());
        } catch (e) {
          req.reject(e);
        }
      }
      pending.clear();
    };
  }
  const id = ++taskSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, fallback: () => ctx.engine[method](...args) });
    worker.postMessage({ id, dataset: workerDataset ? null : ctx.data, method, args });
    workerDataset = ctx.data;
  });
}
const chartSeries = (key, label, color) => ({ key, label, color });
const legend = (series) =>
  `<div class="rv-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`;

function plot(box, rows, series, axis = "date", fmt = pct, band = false) {
  const valid = rows.filter((row) => series.some((s) => Number.isFinite(row[s.key])));
  const finite = rows.flatMap((row) => series.map((s) => row[s.key]).filter(Number.isFinite));
  if (!valid.length) {
    box.innerHTML = '<div class="rv-empty">当前样本不足以绘制此图。</div>';
    return;
  }
  const W = Math.max(360, box.clientWidth || 750),
    H = 240,
    left = 63,
    right = 13,
    top = 13,
    bottom = 29;
  const w = W - left - right,
    h = H - top - bottom;
  let min = Infinity,
    max = -Infinity;
  for (const v of finite) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.001, 0.00001);
  min -= pad;
  max += pad;
  const X = (i) => left + (w * i) / Math.max(1, rows.length - 1);
  const Y = (y) => top + (h * (max - y)) / (max - min);
  const label = (i) => (axis === "day" ? "T+" + rows[i][axis] : String(rows[i][axis] ?? ""));
  const grid = Array.from({ length: 5 }, (_, i) => {
    const val = min + ((max - min) * i) / 4,
      y = Y(val);
    return `<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="#293443" stroke-dasharray="3 4"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${esc(fmt(val))}</text>`;
  }).join("");
  const ticks = [...new Set([0, Math.round((rows.length - 1) / 2), rows.length - 1])]
    .map(
      (i, j, a) =>
        `<text x="${X(i)}" y="${H - 5}" text-anchor="${j === 0 ? "start" : j === a.length - 1 ? "end" : "middle"}">${esc(label(i))}</text>`,
    )
    .join("");
  let filled = "";
  if (band && rows.every((r) => [r.p05, r.p95, r.p25, r.p75].every(Number.isFinite))) {
    const polygon = (lo, hi, color) =>
      `<polygon fill="${color}" points="${rows
        .map((r, i) => X(i) + "," + Y(r[hi]))
        .concat(rows.map((r, i) => X(i) + "," + Y(r[lo])).reverse())
        .join(" ")}"/>`;
    filled = polygon("p05", "p95", "#1a3139") + polygon("p25", "p75", "#225449");
  }
  const lines = series
    .map((s) => {
      let active = false;
      const dots = [],
        rpath = rows
          .map((row, i) => {
            const v = row[s.key];
            if (!Number.isFinite(v)) {
              active = false;
              return "";
            }
            const op = active ? "L" : "M";
            active = true;
            if (!Number.isFinite(rows[i - 1]?.[s.key]) && !Number.isFinite(rows[i + 1]?.[s.key]))
              dots.push(`<circle cx="${X(i)}" cy="${Y(v)}" r="2" fill="${s.color}"/>`);
            return op + X(i).toFixed(1) + "," + Y(v).toFixed(1);
          })
          .join(" ");
      return `<path fill="none" stroke="${s.color}" stroke-width="${band && s.key !== "p50" ? 1 : 2}" vector-effect="non-scaling-stroke" d="${rpath}"/>${dots.join("")}`;
    })
    .join("");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(series.map((s) => s.label).join("、"))}时间序列" style="font:11px ui-monospace,Consolas,monospace;fill:#9aaabe"><g>${grid}${ticks}${filled}${lines}<line class="rv-crosshair" y1="${top}" y2="${H - bottom}" stroke="#b6c7d7" stroke-dasharray="3 4"/></g></svg><div class="rv-tooltip"></div>`;
  const svg = box.querySelector("svg"),
    tip = box.querySelector(".rv-tooltip"),
    cross = box.querySelector(".rv-crosshair");
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect(),
      local = e.clientX - r.left;
    const i = Math.max(
      0,
      Math.min(rows.length - 1, Math.round((((local / r.width) * W - left) / w) * (rows.length - 1))),
    );
    tip.textContent = [label(i), ...series.map((s) => s.label + "   " + fmt(rows[i][s.key]))].join("\n");
    tip.style.display = "block";
    tip.style.top = "4px";
    tip.style.left = Math.max(2, Math.min(local + 10, r.width - tip.offsetWidth - 3)) + "px";
    cross.setAttribute("x1", X(i));
    cross.setAttribute("x2", X(i));
    cross.style.display = "block";
  };
  svg.onpointerleave = () => {
    tip.style.display = "none";
    cross.style.display = "none";
  };
}
function matrixGrid(matrix, keys, labels = {}) {
  if (!keys.length) return '<div class="rv-empty">没有重叠样本。</div>';
  return `<div class="rv-scroll"><table class="rv-table"><thead><tr><th>相关系数</th>${keys.map((k) => `<th>${esc(labels[k] || k)}</th>`).join("")}</tr></thead><tbody>${keys
    .map(
      (key) =>
        `<tr><td>${esc(labels[key] || key)}</td>${keys
          .map((other) => {
            const v = matrix?.[key]?.[other];
            const color = Number.isFinite(v)
              ? (v >= 0 ? "rgba(56,153,132," : "rgba(154,97,168,") + (Math.abs(v) * 0.55 + 0.03) + ")"
              : "transparent";
            return `<td class="rv-cell-matrix" style="background:${color}">${num(v, 2)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
}
function drawBars(values) {
  const max = Math.max(...values.map((v) => Math.abs(v[1])).filter(Number.isFinite), 0.01);
  return `<div class="rv-allocation">${values.map(([name, val, format = pct]) => `<div><div class="rv-barlabel"><span>${esc(name)}</span><span>${esc(format(val))}</span></div><div class="rv-track"><i style="width:${Number.isFinite(val) ? (Math.abs(val) / max) * 100 : 0}%;background:${val < 0 ? COLORS[1] : COLORS[0]}"></i></div></div>`).join("")}</div>`;
}
function fieldsDates(ctx) {
  const [historyStart, last] = dateLimits(ctx);
  const frozen = ctx.data.universes.mag7 || [];
  const availableFrozen = frozen.length === 7 && frozen.every((s) => ctx.data.assets[s]?.prices?.length);
  const preferFrozen = availableFrozen && ["sample", "mag7"].includes(ctx.pool);
  const first = preferFrozen && historyStart < "2024-01-02" ? "2024-01-02" : historyStart;
  const candidates = [
    ...(ctx.pool === "mag7" && availableFrozen
      ? []
      : [
          [
            "current",
            "当前股票池（" +
              ctx.symbols.filter((s) => ctx.data.assets[s]?.type === "stock").length +
              " 只已覆盖）",
          ],
        ]),
    ...(availableFrozen ? [["mag7", "七股固定池 · 2024 年初确定"]] : []),
  ];
  const attrs = `type="date" required min="${first}" max="${last}"`;
  return (
    select("pool", "研究股票池", candidates, preferFrozen ? "mag7" : "current") +
    input("start", "研究起始日", first, attrs) +
    input("end", "研究截止日", last, attrs)
  );
}
function selectedSymbols(ctx, v) {
  if (v.pool === "mag7") {
    if (v.start < "2024-01-02") throw new Error("七股固定池的最早研究日期为 2024-01-02。");
    return ctx.data.universes.mag7;
  }
  return ctx.symbols;
}
function bindPool(root, ctx) {
  const form = root.querySelector("form"),
    slot = form.elements.pool,
    start = form.elements.start,
    end = form.elements.end;
  const [earliest] = dateLimits(ctx);
  function update(reset) {
    const lower = slot.value === "mag7" && earliest < "2024-01-02" ? "2024-01-02" : earliest;
    start.min = lower;
    end.min = lower;
    if (reset || start.value < lower) start.value = lower;
    if (form.elements.count) {
      const n =
        slot.value === "mag7" ? 7 : ctx.symbols.filter((s) => ctx.data.assets[s]?.type === "stock").length;
      form.elements.count.max = Math.max(n, 1);
      form.elements.count.value = Math.min(Math.max(1, Number(form.elements.count.value)), Math.max(n, 1));
    }
  }
  slot.onchange = () => update(true);
  update(false);
}
function factorInputs(weights) {
  const defaults = Object.fromEntries(factorKeys.map((k) => [k, weights?.[k] ?? 1]));
  return `<details class="rv-weights"><summary>调整本次策略的因子权重</summary><div class="rv-fields">${factorKeys.map((k) => fieldNumber("w_" + k, FACTORS[k], defaults[k], 0, 1000, "any")).join("")}</div></details>`;
}
function formFrame(fields, action, extra = "") {
  return `<form class="rv-form" data-run><div class="rv-fields">${fields}<button class="rv-action" type="submit">${action}</button></div>${extra}<div class="rv-status" aria-live="polite" data-state></div></form><div data-results aria-live="polite"></div>`;
}
function bindRun(root, initial, calculate, display) {
  const form = root.querySelector("[data-run]"),
    result = root.querySelector("[data-results]"),
    button = form.querySelector("button[type=submit]"),
    state = form.querySelector("[data-state]");
  let revision = 0;
  form.addEventListener("input", () => {
    revision++;
    state.textContent = "参数已更改，运行后更新结果。";
  });
  const run = async (e) => {
    e?.preventDefault();
    if (!form.reportValidity()) return;
    const thisRev = ++revision;
    button.disabled = true;
    state.textContent = "正在计算…";
    try {
      const values = Object.fromEntries(new FormData(form));
      if (values.start && values.end && values.start >= values.end)
        throw new Error("截止日期须晚于起始日期。");
      const output = await calculate(values);
      if (!root.isConnected || !root.contains(result) || revision !== thisRev) return;
      display(result, output, values);
      state.textContent = "";
    } catch (e) {
      if (revision === thisRev) {
        result.innerHTML = `<div class="rv-error" role="alert">${esc(e.message || e)}</div>`;
        state.textContent = "";
      }
    } finally {
      button.disabled = false;
    }
  };
  form.onsubmit = run;
  if (initial) run();
  return run;
}
function renderBacktest(root, ctx) {
  const fields =
    fieldsDates(ctx) +
    fieldNumber(
      "count",
      "持仓数量",
      Math.min(5, Math.max(ctx.symbols.length, 1)),
      1,
      Math.max(ctx.symbols.length, 1),
    ) +
    select(
      "frequency",
      "调仓频率",
      [
        ["monthly", "月度"],
        ["weekly", "周度"],
        ["quarterly", "季度"],
      ],
      "monthly",
    ) +
    select(
      "allocation",
      "目标权重",
      [
        ["equal", "等权"],
        ["score", "按评分"],
        ["inverseVol", "波动率倒数"],
      ],
      "equal",
    ) +
    fieldNumber("feeBps", "单边费率（bp）", 3, 0, 500, 0.1) +
    fieldNumber("slippageBps", "单边滑点（bp）", 5, 0, 500, 0.1) +
    fieldNumber("minScore", "最低综合分", 0, 0, 100, 1);
  root.innerHTML = formFrame(fields, "运行回测", factorInputs(ctx.weights));
  bindPool(root, ctx);
  bindRun(
    root,
    true,
    (v) => {
      const weights = Object.fromEntries(factorKeys.map((k) => [k, Number(v["w_" + k])]));
      if (+v.count > selectedSymbols(ctx, v).length) throw new Error("持仓数量超过所选股票池覆盖数。");
      if (!Object.values(weights).some((x) => x > 0)) throw new Error("请为至少一个因子设置正权重。");
      return engineCall(ctx, "backtest", {
        symbols: selectedSymbols(ctx, v),
        weights,
        start: v.start,
        end: v.end,
        count: +v.count,
        frequency: v.frequency,
        allocation: v.allocation,
        feeBps: +v.feeBps,
        slippageBps: +v.slippageBps,
        minScore: +v.minScore,
      });
    },
    (box, out) => {
      const m = out.metrics.strategy,
        series = [
          chartSeries("strategy", "选股策略", COLORS[0]),
          chartSeries("spy", "SPY", COLORS[1]),
          chartSeries("qqq", "QQQ", COLORS[2]),
        ];
      const metricNames = [
        ["total", "累计收益", pct],
        ["cagr", "年化收益", pct],
        ["volatility", "年化波动率", pct],
        ["sharpe", "夏普比率", num],
        ["maxDrawdown", "最大回撤", pct],
        ["winRate", "日胜率", pct],
      ];
      const strategyReturn = m.total,
        spyRet = out.metrics.spy.total,
        qqqRet = out.metrics.qqq.total;
      const relative = [
        ["SPY", spyRet],
        ["QQQ", qqqRet],
      ]
        .filter(([, v]) => Number.isFinite(v))
        .map(([name, v]) => {
          const diff = strategyReturn - v;
          return name + " " + (diff >= 0 ? "高出 " : "低于 ") + num(Math.abs(diff) * 100, 2) + " 个百分点";
        })
        .join("，相对 ");
      box.innerHTML =
        metrics([
          ["累计收益", pct(m.total), "扣除费用与滑点", sign(m.total)],
          ["年化收益", pct(m.cagr), "按持有期折算"],
          ["夏普比率", num(m.sharpe), "日收益年化"],
          ["最大回撤", pct(m.maxDrawdown), "峰值至谷底", sign(m.maxDrawdown)],
        ]) +
        (relative && Number.isFinite(strategyReturn)
          ? `<p class="rv-method">本次区间累计收益相对 ${esc(relative)}。长期有效性仍需更多独立区间检验。</p>`
          : "") +
        panel(
          "累计净值",
          '<div class="rv-chart" data-curve></div>',
          legend(series) + exportButton("导出净值"),
        ) +
        panel(
          "策略与基准对照",
          table(
            ["指标", "选股策略", "SPY", "QQQ"],
            metricNames.map(([key, name, fmt]) => [
              name,
              ...["strategy", "spy", "qqq"].map((k) => fmt(out.metrics[k][key])),
            ]),
          ),
        ) +
        panel(
          "调仓记录",
          table(
            ["执行日", "信号日", "目标持仓", "成交权重合计", "成本 / 净值"],
            [...out.trades]
              .reverse()
              .map((t) => [
                esc(t.date),
                esc(t.signalDate),
                esc(t.symbols.join(" · ") || "现金"),
                pct(t.turnover),
                pct(t.cost, 3),
              ]),
          ),
          `<small>${out.trades.length} 次调仓</small>`,
        ) +
        methodology(
          [
            "曲线以 1 为起始净值。费用和滑点按每次买卖成交额的单边基点计入，现金保留于策略净值中。",
            "固定研究池的历史表现受样本选择和幸存者偏差影响。对多个参数反复试验会夸大样本内最优策略的表现。",
          ],
          out.warnings,
        );
      plot(box.querySelector("[data-curve]"), out.curve, series, "date", (v) => num(v, 2));
      box.querySelector("[data-export]").onclick = () =>
        saveCSV(ctx, "AlphaLens-策略净值.csv", [
          ["日期", "策略", "SPY", "QQQ"],
          ...out.curve.map((r) => [r.date, r.strategy, r.spy, r.qqq]),
        ]);
    },
  );
}
const REGIMES = {
  bull: "牛市",
  bear: "熊市",
  sideways: "震荡市",
  range: "震荡市",
  neutral: "震荡市",
  highVol: "高波动",
  volatile: "高波动",
  "high-vol": "高波动",
  high_vol: "高波动",
  unknown: "样本不足",
};
function renderResearchStudy(root, ctx) {
  root.innerHTML = formFrame(
    fieldsDates(ctx) +
      select(
        "horizon",
        "前瞻窗口",
        [
          [5, "5 个交易日"],
          [21, "21 个交易日"],
          [63, "63 个交易日"],
        ],
        21,
      ),
    "检验因子",
  );
  bindPool(root, ctx);
  bindRun(
    root,
    true,
    (v) =>
      engineCall(ctx, "research", {
        symbols: selectedSymbols(ctx, v),
        weights: ctx.weights,
        start: v.start,
        end: v.end,
        horizon: +v.horizon,
      }),
    (box, out, v) => {
      const rows = out.factors;
      const available = rows.filter((r) => Number.isFinite(r.meanIC));
      const best = available.length ? [...available].sort((a, b) => b.meanIC - a.meanIC)[0] : null;
      const positive = rows.filter((r) => r.ci95?.[0] > 0),
        negative = rows.filter((r) => r.ci95?.[1] < 0);
      const significant = [
        positive.length
          ? "本区间平均 IC 的 95% 区间下界为正的因子有" +
            positive.map((x) => FACTORS[x.key]).join("、") +
            "。"
          : "本区间未检出 95% 区间下界为正的因子。",
        negative.length ? "区间上界为负的因子有" + negative.map((x) => FACTORS[x.key]).join("、") + "。" : "",
        "区间按单因子估算，未校正多重比较。",
      ].join("");
      const regimeKeys = [...new Set(rows.flatMap((f) => Object.keys(f.byRegime || {})))];
      const keys = rows.map((r) => r.key);
      box.innerHTML =
        metrics([
          ["可评估因子", available.length + " / " + factorKeys.length, "具备有效截面观测"],
          [
            "最高平均 Rank IC",
            best ? num(best.meanIC, 3) : "—",
            best ? FACTORS[best.key] : "样本不足",
            sign(best?.meanIC),
          ],
          ["研究窗口", v.horizon + " 日", "信号后的交易日数"],
          ["截面日期数", num(out.series.length, 0), "详见各因子有效期数"],
        ]) +
        `<p class="rv-method">${esc(significant)}</p>` +
        panel(
          "因子预测能力",
          table(
            [
              "因子",
              "平均 Rank IC",
              "95% HAC 区间",
              "ICIR",
              "正 IC 占比",
              "前半段 IC",
              "后半段 IC",
              "有效期数",
            ],
            rows.map((r) => [
              esc(FACTORS[r.key]),
              signed(r.meanIC),
              r.ci95 ? num(r.ci95[0], 3) + " ～ " + num(r.ci95[1], 3) : "—",
              num(r.icir, 2),
              pct(r.hitRate, 1),
              signed(r.firstHalf),
              signed(r.secondHalf),
              num(r.n, 0),
            ]),
          ),
          exportButton(),
        ) +
        panel(
          "逐期 Rank IC",
          '<div class="rv-chart" data-series></div>',
          `<div class="rv-narrow">${select(
            "factor",
            "查看因子",
            keys.map((k) => [k, FACTORS[k]]),
            best?.key || keys[0],
          )}</div>`,
        ) +
        panel("因子相关性", matrixGrid(out.correlation, keys, FACTORS), "<small>截面因子排序相关</small>") +
        (regimeKeys.length
          ? panel(
              "市场环境分解",
              table(
                ["因子", ...regimeKeys.map((k) => REGIMES[k] || k)],
                rows.map((r) => [esc(FACTORS[r.key]), ...regimeKeys.map((k) => signed(r.byRegime[k]))]),
              ),
            )
          : "") +
        methodology(
          [
            "Rank IC 是同一交易日股票因子排名与后续收益排名的 Spearman 相关系数。正值表示高分股票随后倾向于取得更高收益。",
            "ICIR 以平均 IC 除以逐期 IC 标准差。前后半段与分环境结果用于观察稳定性，短样本与反复检验都会影响结论。空值表示该统计量缺少有效观测。",
          ],
          out.warnings,
        );
      const field = box.querySelector('select[name="factor"]');
      const update = () =>
        plot(
          box.querySelector("[data-series]"),
          out.series,
          [chartSeries(field.value, FACTORS[field.value], COLORS[0])],
          "date",
          (v) => num(v, 2),
        );
      field.onchange = update;
      update();
      box.querySelector("[data-export]").onclick = () =>
        saveCSV(ctx, "AlphaLens-因子有效性.csv", [
          [
            "因子",
            "Mean Rank IC",
            "HAC 95% 下界",
            "HAC 95% 上界",
            "ICIR",
            "正 IC 比例",
            "前半段 IC",
            "后半段 IC",
            "有效期数",
            ...regimeKeys,
          ],
          ...rows.map((r) => [
            FACTORS[r.key],
            r.meanIC,
            r.ci95?.[0],
            r.ci95?.[1],
            r.icir,
            r.hitRate,
            r.firstHalf,
            r.secondHalf,
            r.n,
            ...regimeKeys.map((k) => r.byRegime[k]),
          ]),
        ]);
    },
  );
}
function renderML(root, ctx) {
  root.innerHTML = formFrame(
    fieldsDates(ctx) +
      select(
        "model",
        "模型",
        [
          ["ridge", "岭回归"],
          ["quadratic", "二次特征岭回归"],
        ],
        "ridge",
      ) +
      select(
        "horizon",
        "预测窗口",
        [
          [5, "5 个交易日"],
          [21, "21 个交易日"],
          [63, "63 个交易日"],
        ],
        21,
      ),
    "运行样本外检验",
  );
  bindPool(root, ctx);
  bindRun(
    root,
    true,
    (v) =>
      engineCall(ctx, "learn", {
        symbols: selectedSymbols(ctx, v),
        weights: ctx.weights,
        start: v.start,
        end: v.end,
        horizon: +v.horizon,
        model: v.model,
      }),
    (box, out) => {
      const dif =
        Number.isFinite(out.meanIC) && Number.isFinite(out.baselineIC) ? out.meanIC - out.baselineIC : null;
      const series = [chartSeries("ic", "模型", COLORS[0]), chartSeries("baselineIC", "基准组合", COLORS[1])];
      const foldChoices = out.folds.map((r, i) => [String(i), r.date]);
      const featureTitle = (k) =>
        k
          .split("×")
          .map((x) => (x.endsWith("²") ? (FACTORS[x.slice(0, -1)] || x.slice(0, -1)) + "²" : FACTORS[x] || x))
          .join(" × ");
      box.innerHTML =
        metrics([
          ["样本外平均 IC", num(out.meanIC, 3), "模型的截面预测能力", sign(out.meanIC)],
          ["基准平均 IC", num(out.baselineIC, 3), "同一测试日期"],
          ["IC 差额", num(dif, 3), "模型减去基准", sign(dif)],
          ["测试期数", num(out.folds.length, 0), "按时间顺序评估"],
        ]) +
        panel("样本外预测表现", '<div class="rv-chart" data-foldcurve></div>', legend(series)) +
        panel(
          "各测试期模型系数",
          "<div data-coefficients></div>",
          `<div>${select("fold", "测试信号日", foldChoices, foldChoices.at(-1)?.[0])}</div>`,
        ) +
        panel(
          "滚动检验明细",
          table(
            ["测试信号日", "训练截止", "训练观测", "测试股票", "模型 IC", "基准 IC"],
            [...out.folds]
              .reverse()
              .map((r) => [
                esc(r.date),
                esc(r.trainEnd),
                num(r.nTrain, 0),
                num(r.nTest, 0),
                signed(r.ic),
                signed(r.baselineIC),
              ]),
          ),
          exportButton(),
        ) +
        methodology(
          [
            "每个测试截面仅用此前已实现的监督标签训练。对照相同时间截面的基准 IC，避免用训练拟合优度替代预测能力。",
            "系数会随训练窗和特征相关性变化。二次特征用于检验非线性关系，短历史和频繁调参都会提高过拟合风险。",
          ],
          out.warnings,
        );
      const foldSelect = box.querySelector('select[name="fold"]'),
        coefficients = box.querySelector("[data-coefficients]");
      const showCoefficients = () => {
        const fold = out.folds[Number(foldSelect.value)],
          coefs = Object.entries(fold?.weights || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        coefficients.innerHTML = coefs.length
          ? drawBars(coefs.map(([k, val]) => [featureTitle(k), val, (x) => num(x, 4)]))
          : '<div class="rv-empty">没有可用模型系数。</div>';
      };
      foldSelect.onchange = showCoefficients;
      showCoefficients();
      plot(box.querySelector("[data-foldcurve]"), out.folds, series, "date", (x) => num(x, 2));
      box.querySelector("[data-export]").onclick = () =>
        saveCSV(ctx, "AlphaLens-样本外检验.csv", [
          ["测试日", "训练截止", "训练样本数", "测试截面数", "模型 IC", "基准 IC"],
          ...out.folds.map((r) => [r.date, r.trainEnd, r.nTrain, r.nTest, r.ic, r.baselineIC]),
        ]);
    },
  );
}
function holdingsEditor(quantityLabel) {
  return `<div class="rv-scroll"><table class="rv-table"><thead><tr><th>资产代码</th><th>${esc(quantityLabel)}</th><th></th></tr></thead><tbody data-items></tbody></table></div><div class="rv-hold-actions"><button type="button" class="rv-secondary rv-slim" data-add>＋ 添加资产</button></div>`;
}
function wireHoldings(box, ctx, initial, key, initialQty, minimumRows = 0) {
  const body = box.querySelector("[data-items]"),
    symbols = assetChoices(ctx).map((x) => x[0]);
  function add(symbol = "", value = "") {
    const row = document.createElement("tr");
    const choices = [...new Set([...(symbol ? [symbol] : []), "CASH", ...symbols])];
    row.innerHTML = `<td><select aria-label="资产代码" data-symbol>${choices.map((s) => `<option value="${esc(s)}" ${s === symbol ? "selected" : ""}>${esc(s === "CASH" ? "CASH · 美元现金" : s + " · " + (ctx.data.assets[s]?.name || "未覆盖"))}</option>`).join("")}</select></td><td><input data-quantity type="number" required step="any" min="0.000000001" value="${esc(value)}" aria-label="${key === "shares" ? "股数或现金金额" : "配置权重"}"></td><td><button type="button" class="rv-iconbtn rv-slim" aria-label="移除此资产" data-remove>移除</button></td>`;
    body.append(row);
    row.querySelector("[data-remove]").onclick = () => {
      if (body.children.length <= minimumRows) {
        box.querySelector("[data-edit-error]").textContent = "请至少保留一项资产。";
        return;
      }
      row.remove();
      box.dispatchEvent(new Event("input", { bubbles: true }));
    };
  }
  initial.forEach((h) => add(h.symbol, h[key]));
  box.querySelector("[data-add]").onclick = () => {
    const selected = [...body.querySelectorAll("[data-symbol]")].map((s) => s.value);
    const symbol =
      ["SPY", "QQQ", ...symbols, "CASH"].find(
        (s) => (s === "CASH" || ctx.data.assets[s]) && !selected.includes(s),
      ) || "CASH";
    add(symbol, initialQty);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return () => {
    const seen = new Set(),
      items = [];
    for (const row of body.children) {
      const symbol = row.querySelector("[data-symbol]").value;
      const qty = Number(row.querySelector("[data-quantity]").value);
      if (seen.has(symbol)) throw new Error("同一资产请合并为一行：" + symbol);
      if (symbol !== "CASH" && !ctx.data.assets[symbol])
        throw new Error("当前数据未覆盖 " + symbol + "，请先更新数据或核对代码。");
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("每项资产的股数或权重须大于零。");
      seen.add(symbol);
      items.push({ symbol, [key]: qty });
    }
    return items;
  };
}
function renderPortfolio(root, ctx) {
  const loaded = readHoldings();
  root.innerHTML =
    panel(
      "持仓录入",
      `<p class="rv-note">股票输入股数，CASH 输入美元余额。持仓保存在当前浏览器。</p><div data-editor>${holdingsEditor("股数 / 现金（USD）")}<span data-edit-error role="alert"></span></div><form class="rv-form" data-analyze style="margin:12px;border:0;background:transparent;padding:0"><div class="rv-fields">${select(
        "lookback",
        "历史风险窗口",
        [
          [63, "63 个交易日"],
          [126, "126 个交易日"],
          [252, "252 个交易日"],
          [504, "504 个交易日"],
        ],
        252,
      )}${fieldNumber("volLimit", "年化波动预算（%）", 20, 0.1, 300, 0.1)}${fieldNumber("sectorLimit", "单一行业上限（%）", 40, 0.1, 100, 0.1)}<button class="rv-action" type="submit">保存并分析</button><span class="rv-status" data-state aria-live="polite"></span></div></form>`,
      `<small>估值日 ${esc(ctx.data.asOf)}</small>`,
    ) + '<div data-results aria-live="polite"></div>';
  const editor = root.querySelector("[data-editor]"),
    form = root.querySelector("[data-analyze]"),
    box = root.querySelector("[data-results]"),
    state = form.querySelector("[data-state]");
  const read = wireHoldings(editor, ctx, loaded, "shares", "");
  const empty = () => {
    box.innerHTML = panel(
      "组合风险",
      '<div class="rv-empty">尚未录入持仓。添加资产和股数后，即可查看市值、行业分布及风险贡献。</div>',
    );
  };
  let revision = 0;
  const dirty = () => {
    revision++;
    state.textContent = "保存并分析后更新下方结果。";
  };
  editor.oninput = dirty;
  form.oninput = dirty;
  async function analyze(save) {
    const seq = ++revision,
      button = form.querySelector("button[type=submit]");
    button.disabled = true;
    let persisted = false;
    try {
      const holdings = read();
      if (save) {
        localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
        persisted = true;
      }
      if (!holdings.length) {
        empty();
        state.textContent = save ? "已保存空持仓。" : "";
        return;
      }
      state.textContent = "正在计算风险…";
      const p = await engineCall(ctx, "portfolio", holdings, { lookback: +form.elements.lookback.value });
      if (!root.contains(box) || seq !== revision) return;
      const names = p.holdings.map((h) => h.symbol);
      const sectorNames = {
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
        Unclassified: "未分类",
      };
      const category = (h) =>
        h.symbol === "CASH"
          ? "现金"
          : ctx.data.assets[h.symbol]?.type === "etf"
            ? "ETF（未穿透）"
            : sectorNames[h.sector] || h.sector || "未分类";
      const sectorTotals = {};
      for (const h of p.holdings) {
        const label = category(h);
        sectorTotals[label] = (sectorTotals[label] || 0) + h.weight;
      }
      const sectorMap = Object.entries(sectorTotals).filter(
          ([s]) => !["现金", "ETF（未穿透）", "未分类"].includes(s),
        ),
        largest = sectorMap.slice().sort((a, b) => b[1] - a[1])[0];
      const volLimit = Number(form.elements.volLimit.value) / 100,
        sectorLimit = Number(form.elements.sectorLimit.value) / 100;
      const check = [
        Number.isFinite(p.volatility)
          ? "估计年化波动率" +
            pct(p.volatility, 1) +
            (p.volatility > volLimit ? "超过" : "低于或等于") +
            "本次预算 " +
            pct(volLimit, 1) +
            "。"
          : "历史波动率样本不足。",
      ];
      if (largest)
        check.push(
          "已识别的最大行业敞口为 " +
            largest[0] +
            "（" +
            pct(largest[1], 1) +
            "），" +
            (largest[1] > sectorLimit ? "超过" : "低于或等于") +
            "本次单行业上限 " +
            pct(sectorLimit, 1) +
            "。",
        );
      const unclassified = (sectorTotals["ETF（未穿透）"] || 0) + (sectorTotals["未分类"] || 0);
      if (unclassified > 0) check.push(pct(unclassified, 1) + " 的组合权重缺少底层行业分布，已单列。");
      const amounts = Object.fromEntries(holdings.map((h) => [h.symbol, h.shares]));
      const fields = ["代码", "股数 / 现金 USD", "行业", "市值 USD", "当前权重", "波动风险贡献", "参考权重"];
      const rowData = p.holdings.map((h) => [
        h.symbol,
        amounts[h.symbol],
        category(h),
        h.value,
        h.weight,
        h.contribution,
        h.suggestedWeight,
      ]);
      box.innerHTML =
        metrics([
          ["组合总市值", cash(p.totalValue), "持仓市值与现金之和"],
          ["年化波动率", pct(p.volatility), p.n + " 个共同交易日"],
          ["市场 Beta", num(p.beta), "相对 SPY"],
          ["单日 ES 95%", pct(p.cvar95), "历史尾部平均损失"],
        ]) +
        `<p class="rv-method">${esc(check.join(""))}预算与上限可在上方调整。</p>` +
        panel(
          "仓位与风险贡献",
          table(
            fields,
            p.holdings.map((h) => [
              ctx.data.assets[h.symbol]?.type !== "stock"
                ? esc(h.symbol)
                : `<button class="rv-link" type="button" data-stock="${esc(h.symbol)}">${esc(h.symbol)}</button>`,
              num(amounts[h.symbol], 2),
              esc(category(h)),
              cash(h.value),
              pct(h.weight, 1),
              pct(h.contribution, 1),
              pct(h.suggestedWeight, 1),
            ]),
          ),
          exportButton("导出持仓分析"),
        ) +
        '<div class="rv-cols">' +
        panel(
          "行业敞口",
          drawBars(
            Object.entries(sectorTotals)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => [k, v]),
          ),
        ) +
        panel(
          "历史风险指标",
          table(
            ["指标", "数值"],
            [
              ["单日 VaR 95%", pct(p.var95)],
              ["单日 ES 95%", pct(p.cvar95)],
              ["历史最大回撤", pct(p.maxDrawdown)],
              ["共同收益样本数", num(p.n, 0)],
            ],
          ),
        ) +
        "</div>" +
        panel("资产收益相关性", matrixGrid(p.correlation, names), "<small>同日收益 · Pearson 相关</small>") +
        methodology(
          [
            "风险贡献由各持仓对组合方差的边际贡献计算。历史风险按当前配置重建，实际已实现收益取决于交易历史。",
            "参考配置基于风险模型，不包含投资期限、税费或个人负债等约束。",
          ],
          p.warnings,
        );
      box
        .querySelectorAll("[data-stock]")
        .forEach((b) => (b.onclick = () => ctx.openStock?.(b.dataset.stock)));
      box.querySelector("[data-export]").onclick = () =>
        saveCSV(ctx, "AlphaLens-组合持仓.csv", [fields, ...rowData]);
      state.textContent = save ? "已保存在当前浏览器。" : "已载入本地持仓。";
    } catch (e) {
      if (seq === revision) {
        box.innerHTML = `<div class="rv-error" role="alert">${esc(e.message || e)}</div>`;
        state.textContent = persisted ? "持仓已保存，风险计算尚未完成。" : "";
      }
    } finally {
      button.disabled = false;
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    analyze(true);
  };
  if (loaded.length) analyze(false);
  else empty();
}
function histogram(bins) {
  if (!bins?.length) return '<div class="rv-empty">没有可用路径。</div>';
  const W = 640,
    H = 194,
    l = 46,
    r = 15,
    t = 10,
    b = 30,
    w = W - l - r,
    h = H - t - b;
  const max = Math.max(1, ...bins.map((x) => x.count)),
    step = w / bins.length;
  const bars = bins
    .map((bin, i) => {
      const y = t + h * (1 - bin.count / max);
      return `<rect x="${l + step * i + 1}" width="${Math.max(0.5, step - 2)}" y="${y}" height="${t + h - y}" fill="${bin.high <= 0 ? COLORS[1] : COLORS[0]}" opacity=".83"><title>${pct(bin.low)} 至 ${pct(bin.high)} · ${bin.count} 条路径</title></rect>`;
    })
    .join("");
  const grid = [0, 0.5, 1]
    .map(
      (f) =>
        `<line x1="${l}" y1="${t + h * f}" x2="${W - r}" y2="${t + h * f}" stroke="#283443" stroke-dasharray="3 4"/><text x="${l - 6}" y="${t + h * f + 3}" text-anchor="end">${num(max * (1 - f), 0)}</text>`,
    )
    .join("");
  const ticks = [0, Math.floor(bins.length / 2), bins.length]
    .map(
      (i, j) =>
        `<text x="${l + step * i}" y="${H - 7}" text-anchor="${["start", "middle", "end"][j]}">${pct(i === bins.length ? bins.at(-1).high : bins[i].low, 1)}</text>`,
    )
    .join("");
  return `<div class="rv-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="终值收益分布，横轴为收益率，纵轴为路径数量" style="fill:#96a7ba;font:11px ui-monospace,Consolas,monospace">${grid}${bars}${ticks}</svg></div>`;
}
function renderSimulation(root, ctx) {
  const assets = assetChoices(ctx),
    initialAsset = ctx.data.assets.SPY ? "SPY" : assets[0]?.[0];
  const choices = [
    ["single", "单一资产"],
    ["custom", "自定义配置"],
    ["holdings", "已保存持仓"],
  ];
  const setup = `<div class="rv-fields">${select("source", "配置来源", choices, "single")}<div data-single style="display:contents">${select("asset", "模拟资产", assets, initialAsset)}</div>${select(
    "lookback",
    "历史窗口",
    [
      [63, "63 日"],
      [126, "126 日"],
      [252, "252 日"],
      [504, "504 日"],
    ],
    252,
  )}${fieldNumber("days", "模拟交易日", 63, 1, 504)}${fieldNumber("paths", "路径数", 1000, 100, 5000, 1)}</div>
    <div class="rv-fields" style="margin-top:12px">${fieldNumber("target", "目标累计收益（%）", 10, -99.99, 1000, 0.01)}<div data-price style="display:contents">${input("price", "或输入目标价（USD）", "", 'type="number" min="0.00001" step="any" placeholder="按目标收益率"')}</div>${fieldNumber("block", "连续区块（交易日）", 5, 1, 21)}${fieldNumber("seed", "随机种子", 17, 1, 1000000)}</div>
    <div data-custom hidden style="margin-top:12px">${holdingsEditor("相对权重（%）")}<span data-edit-error role="alert"></span><p class="rv-note">相对权重按总和归一化，现金收益按零计算。</p></div><p class="rv-note" data-sourceinfo style="padding-top:10px"></p><div class="rv-fields"><button class="rv-action" type="submit">运行模拟</button><div class="rv-status" data-state></div></div>`;
  root.innerHTML = `<form class="rv-form" data-run>${setup}</form><div data-results aria-live="polite"></div><div data-compare></div>`;
  const form = root.querySelector("form"),
    custom = form.querySelector("[data-custom]"),
    info = form.querySelector("[data-sourceinfo]");
  const allocations = [
    ["SPY", 60],
    ["QQQ", 40],
  ]
    .filter(([s]) => ctx.data.assets[s])
    .map(([symbol, weight]) => ({ symbol, weight }));
  const readCustom = wireHoldings(custom, ctx, allocations, "weight", 10, 1);
  function sourceChange() {
    const source = form.elements.source.value;
    form.querySelector("[data-single]").hidden = source !== "single";
    form.querySelector("[data-price]").hidden = source !== "single";
    form.elements.price.disabled = source !== "single";
    custom.hidden = source !== "custom";
    custom.querySelectorAll("input,select,button").forEach((x) => (x.disabled = source !== "custom"));
    if (source === "single") {
      const asset = ctx.data.assets[form.elements.asset.value],
        last = asset?.prices?.at(-1);
      info.textContent = last
        ? `参考收盘价 ${cash(last[2])}（${last[0]}）。填写目标价时，按相对当前收盘价的收益折算。`
        : "";
    } else if (source === "holdings") {
      const n = readHoldings().length;
      info.textContent = n
        ? `载入本地组合的 ${n} 项持仓，按当前市值配置。`
        : "请先在投资组合页录入持仓，或选择自定义配置。";
    } else info.textContent = "";
  }
  form.elements.source.onchange = sourceChange;
  form.elements.asset.onchange = sourceChange;
  sourceChange();
  const kept = [];
  function compare() {
    const target = root.querySelector("[data-compare]");
    if (!kept.length) {
      target.innerHTML = "";
      return;
    }
    target.innerHTML = panel(
      "配置情景对照",
      table(
        [
          "配置",
          "估计窗口 / 期限",
          "路径 / 区块 / 种子",
          "目标收益",
          "收益中位数",
          "亏损概率",
          "触及目标概率",
          "尾部平均损失",
          "",
        ],
        kept.map(([name, v, m], i) => [
          esc(name),
          v.lookback + " / " + v.days + " 日",
          v.paths + " / " + v.block + " / " + v.seed,
          pct(v.targetReturn),
          pct(m.median),
          pct(m.pLoss),
          pct(m.pTarget),
          pct(m.cvar95),
          `<button class="rv-iconbtn rv-slim" type="button" data-drop="${i}">移除</button>`,
        ]),
      ),
      "<small>本页已保存的计算结果</small>",
    );
    target.querySelectorAll("[data-drop]").forEach(
      (b) =>
        (b.onclick = () => {
          kept.splice(+b.dataset.drop, 1);
          compare();
        }),
    );
  }
  bindRun(
    root,
    true,
    async (v) => {
      let holdings = [],
        name = "",
        targetReturn = +v.target / 100;
      if (v.source === "single") {
        holdings = [{ symbol: v.asset, weight: 1 }];
        name = v.asset;
        if (v.price && +v.price > 0) {
          const close = ctx.data.assets[v.asset]?.prices.at(-1)?.[2];
          if (!(close > 0)) throw new Error("缺少参考收盘价。");
          targetReturn = +v.price / close - 1;
        }
      } else if (v.source === "holdings") {
        holdings = readHoldings();
        if (!holdings.length) throw new Error("当前浏览器尚未保存持仓。");
        name = holdings.map((h) => h.symbol + "×" + num(h.shares, 2)).join(" · ");
      } else {
        holdings = readCustom();
        if (!holdings.length) throw new Error("请至少配置一项资产。");
        const total = holdings.reduce((n, x) => n + x.weight, 0);
        name = holdings.map((h) => h.symbol + " " + pct(h.weight / total, 1)).join(" · ");
      }
      const opts = {
        lookback: +v.lookback,
        days: +v.days,
        paths: +v.paths,
        block: +v.block,
        seed: +v.seed,
        targetReturn,
        priceOnly: v.source === "single" && Boolean(v.price),
      };
      const result = await engineCall(ctx, "simulate", holdings, opts);
      return { result, name, opts };
    },
    (box, { result: m, name, opts }) => {
      const lines = [
        chartSeries("p05", "P05", COLORS[2]),
        chartSeries("p25", "P25", "#567d83"),
        chartSeries("p50", "中位数", COLORS[0]),
        chartSeries("p75", "P75", "#5e9489"),
        chartSeries("p95", "P95", COLORS[1]),
      ];
      box.innerHTML =
        metrics([
          ["期末亏损概率", pct(m.pLoss, 1), opts.days + " 日后净值低于期初"],
          ["触及目标概率", pct(m.pTarget, 1), "期内触及 " + pct(opts.targetReturn, 1)],
          ["收益中位数", pct(m.median), "终值分布 P50", sign(m.median)],
          ["尾部平均损失", pct(m.cvar95), "最差 5% 终值路径"],
        ]) +
        panel(
          "累计收益分位区间",
          '<div class="rv-chart" data-band></div>',
          legend([lines[0], lines[2], lines[4]]),
        ) +
        '<div class="rv-cols">' +
        panel("终值收益分布", histogram(m.distribution), "<small>路径数</small>") +
        panel(
          "路径风险",
          table(
            ["统计项", "结果"],
            [
              ["历史共同交易日", num(m.n, 0)],
              ["期末 VaR 95%", pct(m.var95)],
              ["期末 ES 95%", pct(m.cvar95)],
              ["最大回撤中位数", pct(m.medianDrawdown)],
              ["最大回撤第 5 百分位", pct(m.worstDrawdown95)],
            ],
          ),
        ) +
        "</div>" +
        `<div class="rv-hold-actions"><button class="rv-secondary" data-keep type="button">加入情景对照</button>${exportButton("导出分位数")}<small class="rv-status">${esc(name)}</small></div>` +
        methodology(
          [
            "每个分位区间来自同一天所有模拟路径的累计收益。触及概率按路径中任一天达到目标统计，期末亏损概率按最后一天统计。",
            opts.priceOnly
              ? "目标价模式依据拆股可比收盘价的历史变动模拟，排除现金股息。历史窗口以外的极端事件可能超出估计范围。"
              : "收益目标采用含分红再投资的复权收益。历史窗口以外的极端事件可能超出估计范围。",
          ],
          m.warnings,
        );
      plot(box.querySelector("[data-band]"), m.bands, lines, "day", (v) => pct(v, 1), true);
      box.querySelector("[data-keep]").onclick = (e) => {
        kept.push([name, opts, m]);
        compare();
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = "已加入对照";
      };
      box.querySelector("[data-export]").onclick = () =>
        saveCSV(ctx, "AlphaLens-模拟分位数.csv", [
          ["模拟日", "P05", "P25", "P50", "P75", "P95"],
          ...m.bands.map((r) => [r.day, r.p05, r.p25, r.p50, r.p75, r.p95]),
        ]);
    },
  );
}
export function renderResearch(view, root, ctx) {
  if (!TITLES[view]) throw Error("未知的研究视图。");
  const [title, desc] = TITLES[view];
  root.innerHTML = `<div class="rv-workbench"><div class="rv-head"><div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div></div><div data-workspace></div></div>`;
  const content = root.querySelector("[data-workspace]");
  ({
    research: renderResearchStudy,
    backtest: renderBacktest,
    ml: renderML,
    simulation: renderSimulation,
    portfolio: renderPortfolio,
  })[view](content, ctx);
}
