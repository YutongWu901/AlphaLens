/* AlphaLens research engine. All dates are ISO US trading dates, all returns decimals. */
export const FACTOR_INFO = {
  value: ["价值", "最近已公开财年每股稀释收益 ÷ 收盘价，以盈利收益率排序。"],
  growth: ["成长", "已公开相邻财年的营业收入同比增速。"],
  quality: ["企业质量", "最近已公开财年净利润 ÷ 营业收入。"],
  momentum: ["价格动量", "过去 252 至 21 个交易日的复权收益，跳过最近一个月。"],
  reversal: ["超跌反转", "过去 21 个交易日复权收益的相反数。"],
  sentiment: ["市场情绪", "过去 20 日按复权涨跌方向签名的成交量总和 ÷ 总成交量，作为买卖压力代理。"],
  earnings: ["盈利预期", "相同预测期间的共识 EPS 修订幅度，分母取此前预期绝对值。"],
  risk: ["财务风险", "负债总额 ÷ 资产总额取负，负债占比较低得分越高。"]
};
export const FACTORS = Object.keys(FACTOR_INFO);
export const DEFAULT_WEIGHTS = {
  value: 18,
  growth: 15,
  quality: 18,
  momentum: 15,
  reversal: 8,
  sentiment: 6,
  earnings: 10,
  risk: 10
};
const ok = Number.isFinite;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
function variance(a) {
  if (a.length < 2) return null;
  const center = mean(a);
  return sum(a.map((v) => (v - center) ** 2)) / (a.length - 1);
}
const sd = (a) => (a.length > 1 ? Math.sqrt(variance(a)) : null);
const quotient = (a, b) => (ok(a) && ok(b) && b !== 0 ? a / b : null);
const ratioChange = (a, b) => (ok(a) && ok(b) && b > 0 ? a / b - 1 : null);
const DAY = 86400000;
function diffDays(a, b) {
  return (Date.parse(a) - Date.parse(b)) / DAY;
}
function bound(v, lo, hi, label, integer = false) {
  if (!ok(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) throw Error(label + "超出允许范围。");
  return v;
}
function quantile(a, p) {
  if (!a.length) return null;
  const sorted = [...a].sort((x, y) => x - y),
    pos = (a.length - 1) * p,
    k = Math.floor(pos);
  return sorted[k] + (pos - k) * (sorted[Math.min(k + 1, sorted.length - 1)] - sorted[k]);
}
function percentileRanks(arr) {
  const indices = arr
    .map((v, i) => [v, i])
    .filter((x) => ok(x[0]))
    .sort((a, b) => a[0] - b[0]);
  const ranks = arr.map(() => null),
    n = indices.length;
  if (n < 2) return ranks;
  for (let i = 0; i < n; ) {
    let end = i + 1;
    while (end < n && indices[end][0] === indices[i][0]) end++;
    for (let j = i; j < end; j++) ranks[indices[j][1]] = (100 * (i + end - 1)) / (2 * (n - 1));
    i = end;
  }
  return ranks;
}
function covariance(a, b) {
  if (a.length < 2 || a.length !== b.length) return null;
  const ma = mean(a),
    mb = mean(b);
  return sum(a.map((v, i) => (v - ma) * (b[i] - mb))) / (a.length - 1);
}
function corr(a, b, rank = false) {
  const pairs = a.map((v, i) => [v, b[i]]).filter(([x, y]) => ok(x) && ok(y));
  if (pairs.length < 3) return null;
  let x = pairs.map((p) => p[0]),
    y = pairs.map((p) => p[1]);
  if (rank) {
    x = percentileRanks(x);
    y = percentileRanks(y);
  }
  return quotient(covariance(x, y), sd(x) * sd(y));
}
function normalizedWeights(input) {
  const src = input ?? DEFAULT_WEIGHTS;
  const w = Object.fromEntries(FACTORS.map((k) => [k, bound(src[k] ?? 0, 0, 1e7, "因子权重")]));
  const total = sum(Object.values(w));
  if (total <= 0) throw Error("请至少启用一个因子。");
  return Object.fromEntries(FACTORS.map((k) => [k, w[k] / total]));
}
function metrics(points, days) {
  const ret = points.slice(1).map((p, i) => p / points[i] - 1),
    sigma = sd(ret),
    peak = { v: points[0] },
    years = diffDays(days.at(-1), days[0]) / 365.25;
  const mdd = Math.min(
    0,
    ...points.map((v) => {
      peak.v = Math.max(peak.v, v);
      return v / peak.v - 1;
    })
  );
  return {
    total: points.at(-1) / points[0] - 1,
    cagr: years > 0 ? (points.at(-1) / points[0]) ** (1 / years) - 1 : null,
    volatility: ok(sigma) ? sigma * Math.sqrt(252) : null,
    sharpe: quotient(mean(ret) * Math.sqrt(252), sigma),
    maxDrawdown: mdd,
    winRate: ret.length ? ret.filter((x) => x > 0).length / ret.length : null
  };
}
function binaryDate(values, day, key = (x) => x) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (key(values[m]) <= day) lo = m + 1;
    else hi = m;
  }
  return lo - 1;
}
function averageBy(items, key, groups) {
  return Object.fromEntries(
    groups.map((g) => [
      g,
      mean(
        items
          .filter((x) => x.regime === g)
          .map((x) => x[key])
          .filter(ok)
      )
    ])
  );
}
function icInterval(observations) {
  // Preserve calendar lags when one cross-section is missing an IC.
  const v = observations.filter(ok),
    n = v.length;
  if (n < 12) return null;
  const center = mean(v),
    lag = Math.min(Math.floor(n / 3), Math.floor(4 * (n / 100) ** (2 / 9)));
  const residual = observations.map((x) => (ok(x) ? x - center : 0));
  let sandwich = sum(residual.map((x) => x * x));
  for (let j = 1; j <= lag; j++) {
    let cross = 0;
    for (let t = j; t < residual.length; t++) cross += residual[t] * residual[t - j];
    sandwich += 2 * (1 - j / (lag + 1)) * cross;
  }
  const radius = 1.96 * Math.sqrt(Math.max(0, sandwich) / (n * (n - 1)));
  return [Math.max(-1, center - radius), Math.min(1, center + radius)];
}
const regimeNames = { bull: "牛市", bear: "熊市", range: "震荡市", volatile: "高波动", unknown: "样本不足" };
const methodologicalWarnings = [
  "默认研究池为当前成分中的已覆盖证券。历史结果受成分选择与幸存者偏差影响，不代表当年整个指数的可投资业绩。",
  "跨行业百分位仅在所选股票池内比较。财报按披露日期滞后使用，估值以最近公开财年稀释 EPS 为基础。"
];
export function createEngine(data) {
  const assets = data.assets ?? {},
    calendar = assets.SPY?.prices;
  if (!Array.isArray(calendar) || calendar.length < 2)
    throw Error("需要含交易日期与复权收盘价的 SPY 历史行情。");
  const dates = calendar.map((r) => r[0]);
  const index = new Map(dates.map((d, i) => [d, i]));
  if (dates.some((d, i) => i && dates[i - 1] >= d)) throw Error("SPY 交易日须严格递增。");
  const prepared = new Map();
  function series(s) {
    if (prepared.has(s)) return prepared.get(s);
    const a = assets[s];
    if (!a) throw Error("未收录证券 " + s);
    const rows = new Map(a.prices.map((r) => [r[0], r]));
    const price = dates.map((d) => rows.get(d) ?? null);
    const ret = price.map((r, i) => ratioChange(r?.[1], price[i - 1]?.[1]));
    const priceReturns = price.map((r, i) => ratioChange(r?.[2], price[i - 1]?.[2]));
    const facts = [...(a.fundamentals ?? [])].sort((x, y) => x.filed.localeCompare(y.filed));
    const estimates = [...(a.estimates ?? [])]
      .filter((e) => e.asOf)
      .sort((x, y) => x.asOf.localeCompare(y.asOf));
    const out = { a, price, ret, priceReturns, facts, estimates };
    prepared.set(s, out);
    return out;
  }
  function calendarIndex(date) {
    const i = binaryDate(dates, date ?? data.asOf ?? dates.at(-1));
    if (i < 0) throw Error("所选日期早于历史行情。");
    return i;
  }
  function pool(symbols) {
    const xs = [...new Set(symbols ?? data.universes?.sample ?? Object.keys(assets))];
    return xs.filter((s) => assets[s]?.type === "stock");
  }
  // Explicit date intervals are inclusive. Missing membership does not imply eligibility.
  const eligible = (s, d, m) => !m || (m[s] ?? []).some(([a, b]) => a <= d && (!b || d <= b));
  function warnings(opts) {
    if (opts.membership)
      return [
        "已按传入的历史成分区间筛选。退市收益和成分表完整性仍取决于数据来源。",
        methodologicalWarnings[1]
      ];
    const frozen = data.universes?.mag7,
      selected = pool(opts.symbols);
    if (
      frozen?.length === 7 &&
      selected.length === 7 &&
      selected.every((s) => frozen.includes(s)) &&
      dates[span(opts)[0]] >= "2024-01-02"
    ) {
      return [
        "七股研究池在 2024-01-02 前已公开定义，成分固定。结果只描述这个集中于大型科技企业的小样本。",
        methodologicalWarnings[1]
      ];
    }
    return [...methodologicalWarnings];
  }
  function pointInTime(s, i, afterClose = false) {
    const { facts, estimates } = series(s),
      date = dates[i],
      priorDate = dates[i - 1] ?? "0000-00-00";
    // A filing stamped with a date could arrive after the close. Use only prior calendar dates.
    const cutoff =
      afterClose && date === data.asOf ? date : new Date(Date.parse(date) - DAY).toISOString().slice(0, 10);
    const candidates = facts
      .slice(0, binaryDate(facts, cutoff, (x) => x.filed) + 1)
      .filter((f) => f.periodEnd < date)
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.filed.localeCompare(a.filed));
    const f = candidates[0] && diffDays(date, candidates[0].periodEnd) <= 550 ? candidates[0] : null;
    const prev = f
      ? candidates.find(
          (x) => diffDays(f.periodEnd, x.periodEnd) > 300 && diffDays(f.periodEnd, x.periodEnd) < 430
        )
      : null;
    const z = estimates[binaryDate(estimates, cutoff, (x) => x.asOf)];
    const estimate =
      z && diffDays(date, z.asOf) <= 120 && (!z.periodEnd || z.periodEnd >= priorDate) ? z : null;
    return { f, prev, estimate };
  }
  function alignedEps(f, a) {
    if (!f) return null;
    if (ok(f.epsSplitAdjusted)) return f.epsSplitAdjusted;
    if (f.splitBasisVerified && ok(f.eps)) return f.eps;
    if (!Array.isArray(a.splits) || !ok(f.eps)) return null;
    const later = a.splits.filter((z) => z[0] > f.periodEnd);
    if (later.some((z) => !ok(z[1]) || z[1] <= 0)) return null;
    return f.eps / later.reduce((v, z) => v * z[1], 1);
  }
  function regime(asOf) {
    const i = calendarIndex(asOf),
      { price, ret } = series("SPY"),
      now = price[i]?.[1],
      history = price
        .slice(Math.max(0, i - 199), i + 1)
        .map((r) => r?.[1])
        .filter(ok);
    const r = ret.slice(Math.max(1, i - 19), i + 1).filter(ok),
      vol = r.length === 20 ? sd(r) * Math.sqrt(252) : null;
    const ma = history.length === 200 ? mean(history) : null,
      change63 = ratioChange(now, price[i - 63]?.[1]);
    const key =
      vol === null || ma === null || change63 === null
        ? "unknown"
        : vol >= 0.3
          ? "volatile"
          : now > ma && change63 > 0
            ? "bull"
            : now < ma && change63 < 0
              ? "bear"
              : "range";
    const explanation =
      "SPY 20 日年化波动 ≥ 30% 优先判为高波动。价格高于 200 日均线且 63 日收益为正判为牛市，方向均相反判为熊市，其余为震荡。";
    return { key, name: regimeNames[key], volatility: vol, ma200: ma, change63, explanation, date: dates[i] };
  }
  const observationCache = new Map();
  function observe(s, i, afterClose = false) {
    const cacheKey = s + "|" + i + (afterClose ? "|after" : "");
    if (observationCache.has(cacheKey)) return observationCache.get(cacheKey);
    const { a, price, ret } = series(s),
      p = price[i],
      { f, prev, estimate } = pointInTime(s, i, afterClose);
    if (!p || !ok(p[1]) || p[1] <= 0) return null;
    const eps = alignedEps(f, a),
      value = quotient(eps, p[2]),
      rev = ratioChange(f?.revenue, prev?.revenue);
    const m = ratioChange(price[i - 21]?.[1], price[i - 252]?.[1]),
      rr = ratioChange(p[1], price[i - 21]?.[1]);
    const last20 = ret.slice(Math.max(1, i - 19), i + 1),
      volume = price.slice(Math.max(1, i - 19), i + 1).map((v) => v?.[3]);
    const sentiment =
      last20.length === 20 && last20.every(ok) && volume.every((x) => ok(x) && x >= 0)
        ? quotient(sum(last20.map((r, j) => Math.sign(r) * volume[j])), sum(volume))
        : null;
    const volReturns = ret.slice(Math.max(1, i - 62), i + 1),
      vol = volReturns.length === 63 && volReturns.every(ok) ? sd(volReturns) * Math.sqrt(252) : null;
    const trailing = price.slice(Math.max(0, i - 251), i + 1).map((r) => r?.[1]);
    const dd =
      trailing.length === 252 && trailing.every((x) => ok(x) && x > 0)
        ? p[1] / Math.max(...trailing) - 1
        : null;
    const revision =
      ok(estimate?.forwardEPS) && ok(estimate?.previousForwardEPS)
        ? quotient(estimate.forwardEPS - estimate.previousForwardEPS, Math.abs(estimate.previousForwardEPS))
        : null;
    const raw = {
      value,
      growth: rev,
      quality: f?.revenue > 0 ? quotient(f.netIncome, f.revenue) : null,
      momentum: m,
      reversal: ok(rr) ? -rr : null,
      sentiment,
      earnings: revision,
      risk: f?.assets > 0 && ok(f.liabilities) ? -f.liabilities / f.assets : null
    };
    const row = {
      symbol: s,
      name: a.name ?? s,
      sector: a.sector ?? "未分类",
      date: dates[i],
      price: p[2] ?? null,
      change: ret[i],
      volatility: vol,
      drawdown: dd,
      raw,
      eps,
      fundamental: f,
      previousFundamental: prev,
      estimate
    };
    if (observationCache.size > 180000) observationCache.clear();
    observationCache.set(cacheKey, row);
    return row;
  }
  function rank(opts = {}) {
    const i = calendarIndex(opts.asOf),
      w = normalizedWeights(opts.weights),
      universe = pool(opts.symbols);
    const currentSnapshot = opts.afterClose === true && dates[i] === data.asOf;
    const rows = universe
      .filter((s) => eligible(s, dates[i], opts.membership))
      .map((s) => observe(s, i, currentSnapshot))
      .filter(Boolean)
      .map((r) => ({ ...r, factors: {} }));
    for (const k of FACTORS) {
      const ranks = percentileRanks(rows.map((r) => r.raw[k]));
      rows.forEach((r, j) => (r.factors[k] = ranks[j]));
    }
    for (const r of rows) {
      const valid = FACTORS.filter((k) => ok(r.factors[k]) && w[k] > 0);
      r.coverage = sum(valid.map((k) => w[k]));
      r.score = r.coverage + 1e-10 >= 0.5 ? sum(valid.map((k) => w[k] * r.factors[k])) / r.coverage : null;
      const f = r.fundamental,
        prev = r.previousFundamental;
      const marginChange =
        prev?.revenue > 0 && ok(prev.netIncome) && ok(r.raw.quality)
          ? r.raw.quality - prev.netIncome / prev.revenue
          : null;
      const base =
        ok(r.drawdown) &&
        r.drawdown <= -0.2 &&
        r.factors.quality >= 60 &&
        r.factors.value >= 50 &&
        r.raw.value > 0 &&
        ok(r.raw.growth) &&
        r.raw.growth >= 0 &&
        ok(marginChange) &&
        marginChange >= -0.02 &&
        f.netIncome > 0;
      r.watch = Boolean(base && r.estimate?.forwardEPS > 0 && ok(r.raw.earnings) && r.raw.earnings >= -0.05);
      r.watchCandidate = Boolean(base);
      r.watchReason = r.watch
        ? "回撤至少 20%，质量与估值达标，营收未下滑、净利率降幅未超 2 个百分点，预期盈利为正且修订不低于 −5%。"
        : base && !ok(r.raw.earnings)
          ? "财务与回撤筛选通过，缺少可比盈利预期修订，待核实。"
          : base
            ? "预期盈利为负或为零，或盈利预期下修超过 5%。"
            : "尚未同时达到回撤、估值、质量与基本面稳定条件。";
    }
    return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.symbol.localeCompare(b.symbol));
  }
  function stock(s, opts = {}) {
    const i = calendarIndex(opts.asOf),
      universe = pool(opts.symbols);
    if (!universe.includes(s)) universe.push(s);
    const row = rank({ ...opts, symbols: universe }).find((r) => r.symbol === s);
    if (!row) throw Error("所选日期缺少该股票的可用行情。");
    const history = [],
      { price, a } = series(s);
    for (let j = Math.max(0, i - 1260); j < i; j++) {
      if (dates[j].slice(0, 7) === dates[j + 1].slice(0, 7)) continue;
      const eps = alignedEps(pointInTime(s, j).f, a);
      if (eps > 0 && price[j]?.[2] > 0) history.push({ date: dates[j], pe: price[j][2] / eps });
    }
    const vals = history.map((x) => x.pe),
      enough = vals.length >= 12,
      pe = row.eps > 0 ? row.price / row.eps : null;
    const med = enough ? quantile(vals, 0.5) : null,
      target = med !== null && row.eps > 0 ? med * row.eps : null;
    const valuation = {
      pe,
      low: enough ? quantile(vals, 0.1) : null,
      median: med,
      high: enough ? quantile(vals, 0.9) : null,
      target,
      upside: ratioChange(target, row.price),
      n: vals.length,
      history
    };
    const ordered = FACTORS.filter((k) => ok(row.factors[k])).sort((a, b) => row.factors[b] - row.factors[a]);
    const strengths = ordered
      .filter((k) => row.factors[k] >= 60)
      .slice(0, 3)
      .map((k) => FACTOR_INFO[k][0] + "位于股票池第 " + Math.round(row.factors[k]) + " 百分位。");
    const risks = ordered
      .filter((k) => row.factors[k] <= 35)
      .reverse()
      .slice(0, 3)
      .map((k) => FACTOR_INFO[k][0] + "仅处于第 " + Math.round(row.factors[k]) + " 百分位。");
    if (!ok(row.raw.earnings)) risks.push("缺少同口径盈利预期修订，无法确认前瞻盈利稳定性。");
    if (row.drawdown <= -0.2) risks.push("从 252 日高点回撤已超过 20%。");
    if (!enough) risks.push("公开盈利数据匹配后的月末历史估值样本少于 12 个。");
    return { ...row, valuation, strengths, risks };
  }
  function span(opts) {
    const stop = calendarIndex(opts.end ?? opts.asOf);
    const requested = opts.start;
    let start = requested ? binaryDate(dates, requested) : Math.min(252, Math.max(0, stop - 64));
    if (requested && (start < 0 || dates[start] < requested)) start++;
    if (stop - start < 3) throw Error("请选择至少四个交易日并包含历史行情的研究区间。");
    return [start, stop];
  }
  function periodGroup(day, freq) {
    if (freq === "monthly") return day.slice(0, 7);
    if (freq === "quarterly") return day.slice(0, 4) + "Q" + Math.floor((Number(day.slice(5, 7)) - 1) / 3);
    // Mondays start a new UTC calendar week.
    return Math.floor((Date.parse(day) / DAY + 3) / 7);
  }
  function requiredReturn(s, i) {
    const r = series(s).ret[i];
    if (!ok(r) || r <= -1)
      throw Error(
        s + " 在 " + dates[i] + " 缺少连续有效的复权行情。请补全停牌、退市或公司行动数据后再运行。"
      );
    return r;
  }
  function backtest(opts = {}) {
    const [start, stop] = span(opts),
      count = bound(Number(opts.count ?? 5), 1, 5000, "持股数", true);
    const frequency = opts.frequency ?? "monthly",
      allocation = opts.allocation ?? "equal";
    if (
      !["monthly", "weekly", "quarterly"].includes(frequency) ||
      !["equal", "inverseVol", "score"].includes(allocation)
    )
      throw Error("未知调仓或权重规则。");
    const costRate =
      (bound(Number(opts.feeBps ?? 3), 0, 500, "单边费用") +
        bound(Number(opts.slippageBps ?? 5), 0, 500, "单边滑点")) /
      10000;
    const minScore = bound(Number(opts.minScore ?? 0), 0, 100, "最低评分"),
      trades = [];
    const bench = Object.fromEntries(
      ["spy", "qqq"].map((k) => [k, series(k.toUpperCase()).price[start]?.[1]])
    );
    if (Object.values(bench).some((p) => !ok(p) || p <= 0)) throw Error("起始日缺少 SPY 或 QQQ 基准价格。");
    let nav = 1,
      positions = {},
      cash = 1,
      previousGroup = null;
    const curve = [{ date: dates[start], strategy: 1, spy: 1, qqq: 1 }];
    for (let i = start + 1; i <= stop; i++) {
      for (const s of Object.keys(positions)) positions[s] *= 1 + requiredReturn(s, i);
      nav = cash + sum(Object.values(positions));
      const signalIndex = i - 1,
        group = periodGroup(dates[i], frequency);
      if (group !== previousGroup) {
        const rows = rank({ ...opts, asOf: dates[signalIndex], afterClose: false })
          .filter(
            (r) =>
              ok(r.score) &&
              r.score >= minScore &&
              (allocation !== "inverseVol" || r.volatility > 0) &&
              (allocation !== "score" || r.score > 0)
          )
          .slice(0, count);
        const units = rows.map((r) =>
          allocation === "inverseVol" ? 1 / r.volatility : allocation === "score" ? r.score : 1
        );
        const total = sum(units),
          target = Object.fromEntries(rows.map((r, j) => [r.symbol, units[j] / total]));
        // Rebalance at this close using the preceding close's signal. A selected security
        // without a tradable close is a data failure, not a hindsight replacement.
        for (const s of Object.keys(target))
          if (!(series(s).price[i]?.[2] > 0)) throw Error(s + " 在调仓日 " + dates[i] + " 没有成交价。");
        const all = new Set([...Object.keys(target), ...Object.keys(positions)]);
        const traded = (after) =>
          sum([...all].map((s) => Math.abs((target[s] ?? 0) * after - (positions[s] ?? 0))));
        // The budget equals post-cost NAV plus charges on the actual buy and sell notionals.
        let post = nav;
        for (let k = 0; k < 25; k++) post = nav - costRate * traded(post);
        const turnover = traded(post) / nav,
          cost = (nav - post) / nav;
        positions = Object.fromEntries(Object.entries(target).map(([s, w]) => [s, post * w]));
        cash = rows.length ? 0 : post;
        nav = post;
        trades.push({
          date: dates[i],
          signalDate: dates[signalIndex],
          symbols: rows.map((r) => r.symbol),
          target,
          turnover,
          cost
        });
        previousGroup = group;
      }
      const point = { date: dates[i], strategy: nav };
      for (const k of ["spy", "qqq"]) {
        const p = series(k.toUpperCase()).price[i]?.[1];
        if (!(p > 0)) throw Error("缺少基准行情 " + k.toUpperCase() + " " + dates[i]);
        point[k] = p / bench[k];
      }
      curve.push(point);
    }
    if (!trades.some((t) => t.symbols.length)) throw Error("在此区间与筛选规则下没有可投资的股票。");
    const labels = curve.map((x) => x.date),
      metricsBySeries = Object.fromEntries(
        ["strategy", "spy", "qqq"].map((k) => [
          k,
          metrics(
            curve.map((p) => p[k]),
            labels
          )
        ])
      );
    return {
      curve,
      metrics: metricsBySeries,
      trades,
      warnings: [
        ...warnings(opts),
        "信号在前一交易日收盘后确定，下一交易日收盘调仓。按实际买入及卖出金额双向计费，日间按市值漂移。现金与夏普基准利率为零。胜率为净收益为正的交易日占比。"
      ]
    };
  }
  function samples(opts) {
    const [start, stop] = span(opts),
      h = bound(Number(opts.horizon ?? 21), 1, 126, "预测期", true);
    const blocks = [];
    for (let i = start; i + 1 + h <= stop; i += h) {
      const ranked = rank({ ...opts, asOf: dates[i], afterClose: false }),
        rows = [];
      for (const r of ranked) {
        const { price, ret } = series(r.symbol),
          begin = i + 1,
          end = begin + h;
        if (!price[begin] || !price[end] || ret.slice(begin + 1, end + 1).some((v) => !ok(v))) {
          throw Error(
            r.symbol +
              " 在 " +
              dates[begin] +
              " 至 " +
              dates[end] +
              " 缺少连续的未来收益标签，请缩短区间或补充事件收益。"
          );
        }
        const y = ratioChange(price[end][1], price[begin][1]);
        if (ok(y)) rows.push({ ...r, y });
      }
      if (rows.length >= 3)
        blocks.push({ date: dates[i], exit: dates[i + h + 1], regime: regime(dates[i]).key, rows });
    }
    return blocks;
  }
  function research(opts = {}) {
    const blocks = samples(opts);
    if (blocks.length < 2) throw Error("研究至少需要两个完整的预测期且每期至少三只股票。");
    const seriesIC = [],
      pairs = {};
    for (const { date, regime: state, rows } of blocks) {
      const item = { date, regime: state },
        future = rows.map((r) => r.y);
      for (const k of FACTORS) {
        const x = rows.map((r) => r.factors[k]);
        item[k] = corr(x, future, true);
        for (const o of FACTORS) {
          const correlation = corr(
            x,
            rows.map((r) => r.factors[o]),
            true
          );
          if (ok(correlation)) (pairs[k + "|" + o] ??= []).push(correlation);
        }
      }
      seriesIC.push(item);
    }
    const midpoint = Math.floor(seriesIC.length / 2);
    const factors = FACTORS.map((key) => {
      const v = seriesIC.map((x) => x[key]).filter(ok);
      return {
        key,
        meanIC: mean(v),
        ci95: icInterval(seriesIC.map((x) => x[key])),
        icir: quotient(mean(v), sd(v)),
        hitRate: v.length ? v.filter((x) => x > 0).length / v.length : null,
        n: v.length,
        firstHalf: mean(
          seriesIC
            .slice(0, midpoint)
            .map((x) => x[key])
            .filter(ok)
        ),
        secondHalf: mean(
          seriesIC
            .slice(midpoint)
            .map((x) => x[key])
            .filter(ok)
        ),
        byRegime: averageBy(seriesIC, key, Object.keys(regimeNames))
      };
    });
    const correlation = Object.fromEntries(
      FACTORS.map((k) => [k, Object.fromEntries(FACTORS.map((j) => [j, mean(pairs[k + "|" + j] ?? [])]))])
    );
    return {
      factors,
      correlation,
      series: seriesIC,
      warnings: [
        ...warnings(opts),
        "各横截面使用 Spearman 秩相关。收益从信号次日收盘开始，按预测期步进，收益窗口不重叠。ICIR 为每期 IC 均值 / 样本标准差，未经年化。至少 12 期时给出均值的 Newey-West 近似 95% 区间，使用 Bartlett 核及自动滞后阶数。各因子单独估计，未作多重检验校正。"
      ]
    };
  }
  function featureNames(model) {
    return model === "ridge"
      ? [...FACTORS]
      : [
          ...FACTORS,
          ...FACTORS.map((k) => k + "²"),
          "value×quality",
          "growth×momentum",
          "reversal×sentiment"
        ];
  }
  function features(row, model) {
    const x = FACTORS.map((k) => (ok(row.factors[k]) ? row.factors[k] / 50 - 1 : 0));
    return model === "ridge" ? x : [...x, ...x.map((v) => v * v), x[0] * x[2], x[1] * x[3], x[4] * x[5]];
  }
  function solveRidge(gram, response, n, lambda) {
    const p = response.length;
    const a = gram.map((row, i) => row.map((v, j) => v + (i === j ? n * lambda : 0)).concat(response[i]));
    for (let c = 0; c < p; c++) {
      const pivot = a[c][c];
      for (let j = c; j <= p; j++) a[c][j] /= pivot;
      for (let r = 0; r < p; r++) {
        if (r === c) continue;
        const f = a[r][c];
        for (let j = c; j <= p; j++) a[r][j] -= f * a[c][j];
      }
    }
    return a.map((row) => row[p]);
  }
  function learn(opts = {}) {
    const model = opts.model ?? "ridge";
    if (!["ridge", "quadratic"].includes(model)) throw Error("模型选项无效。");
    const blocks = samples(opts),
      names = featureNames(model),
      p = names.length;
    const gram = Array.from({ length: p }, () => Array(p).fill(0)),
      response = Array(p).fill(0);
    let train = 0,
      nTrain = 0,
      latest = [],
      trainThrough = null,
      lastCoefficients = {};
    const folds = [];
    const build = (b) => {
      const rows = b.rows.filter((r) => ok(r.score));
      const x = rows.map((r) => features(r, model));
      const centers = names.map((_, j) => mean(x.map((v) => v[j])) ?? 0);
      return {
        rows,
        x: x.map((v) => v.map((z, j) => z - centers[j])),
        y: percentileRanks(rows.map((r) => r.y)).map((v) => (ok(v) ? v / 50 - 1 : null))
      };
    };
    const trainingBlocks = blocks.map(build);
    for (let test = 0; test < blocks.length; test++) {
      const current = blocks[test];
      while (train < test && blocks[train].exit < current.date) {
        const { x, y } = trainingBlocks[train];
        if (x.length >= 3) {
          for (let i = 0; i < x.length; i++) {
            for (let j = 0; j < p; j++) {
              response[j] += x[i][j] * y[i];
              for (let k = 0; k < p; k++) gram[j][k] += x[i][j] * x[i][k];
            }
          }
          nTrain += x.length;
        }
        trainThrough = blocks[train].exit;
        train++;
      }
      if (train < 12 || nTrain < 60) continue;
      const { x, rows, y } = trainingBlocks[test];
      if (x.length < 3) continue;
      // Penalty fixed before out-of-sample testing and scaled by training row count.
      latest = solveRidge(gram, response, nTrain, 0.1);
      const pred = x.map((v) => sum(v.map((z, k) => z * latest[k])));
      const weights = Object.fromEntries(names.map((k, j) => [k, latest[j]]));
      lastCoefficients = weights;
      folds.push({
        date: current.date,
        trainEnd: trainThrough,
        nTrain,
        nTest: x.length,
        ic: corr(pred, y, true),
        baselineIC: corr(
          rows.map((r) => r.score),
          y,
          true
        ),
        weights
      });
    }
    if (!folds.length) throw Error("扩展窗口需要至少 12 个已实现训练期、60 个有效训练样本和一个独立测试期。");
    const comparable = folds.filter((f) => ok(f.ic) && ok(f.baselineIC));
    return {
      folds,
      meanIC: mean(comparable.map((f) => f.ic)),
      baselineIC: mean(comparable.map((f) => f.baselineIC)),
      weights: lastCoefficients,
      warnings: [
        ...warnings(opts),
        "将当期因子映射到 [-1,1]，缺失置于截面中位秩，训练目标为未来收益的截面秩。固定岭惩罚 0.1，逐期扩展训练，只纳入标签终点早于测试信号日的样本。系数为最新样本外折的截面模型系数。"
      ]
    };
  }
  function prepareHoldings(holdings, opts, priceOnly = false) {
    if (!Array.isArray(holdings) || !holdings.length) throw Error("请先添加至少一个持仓或配置权重。");
    const i = calendarIndex(opts.asOf ?? opts.end),
      n = bound(Number(opts.lookback ?? 252), 20, 2520, "历史窗口", true);
    const isShares = holdings.every((h) => h.shares !== undefined && h.weight === undefined);
    if (!isShares && !holdings.every((h) => h.weight !== undefined && h.shares === undefined))
      throw Error("同一组合请统一按股数或相对权重输入。");
    const values = {};
    for (const h of holdings) {
      const s = String(h.symbol).toUpperCase().trim();
      if (s !== "CASH" && !assets[s]) throw Error("未覆盖的持仓 " + s);
      const amount = bound(Number(isShares ? h.shares : h.weight), 0, 1e15, "持仓数量或权重");
      if (!amount) continue;
      const close = s === "CASH" ? 1 : series(s).price[i]?.[2];
      if (!(close > 0)) throw Error(s + " 在估值日缺少收盘价。");
      values[s] = (values[s] ?? 0) + (isShares ? amount * close : amount);
    }
    const total = sum(Object.values(values));
    if (!(total > 0)) throw Error("持仓总额必须大于零。");
    const symbols = Object.keys(values),
      w = symbols.map((s) => values[s] / total);
    const returns = [],
      indexes = [],
      benchmark = [];
    for (let j = Math.max(1, i - n + 1); j <= i; j++) {
      const col = symbols.map((s) => (s === "CASH" ? 0 : series(s)[priceOnly ? "priceReturns" : "ret"][j]));
      const spy = series("SPY").ret[j];
      if (col.every((x) => ok(x) && x > -1) && ok(spy)) {
        returns.push(col);
        indexes.push(j);
        benchmark.push(spy);
      }
    }
    if (returns.length < 20) throw Error("该组合的共同有效日收益少于 20 条。");
    return {
      symbols,
      w,
      values,
      totalValue: isShares ? total : null,
      returns,
      indexes,
      benchmark,
      i,
      lookback: n
    };
  }
  function lossStats(returns, alpha = 0.05) {
    const r = [...returns].sort((a, b) => a - b),
      m = r.length * alpha,
      k = Math.floor(m);
    const tail = (sum(r.slice(0, k)) + (m - k) * (r[k] ?? 0)) / m;
    return { var95: Math.max(0, -quantile(r, alpha)), cvar95: Math.max(0, -tail) };
  }
  function portfolio(holdings, opts = {}) {
    const { symbols, w, values, totalValue, returns, indexes, benchmark, lookback } = prepareHoldings(
      holdings,
      opts
    );
    const columns = symbols.map((_, j) => returns.map((row) => row[j])),
      port = returns.map((row) => sum(row.map((v, j) => v * w[j])));
    const varP = variance(port),
      sds = columns.map(sd),
      varBench = variance(benchmark);
    const cashWeight = symbols.includes("CASH") ? w[symbols.indexOf("CASH")] : 0;
    const inverse = symbols.map((s, j) => (s !== "CASH" && sds[j] > 0 ? 1 / sds[j] : 0)),
      tot = sum(inverse);
    const pos = symbols.map((symbol, j) => ({
      symbol,
      sector: symbol === "CASH" ? "现金" : (assets[symbol].sector ?? "未分类"),
      weight: w[j],
      value: totalValue === null ? null : values[symbol],
      contribution: varP > 0 ? (w[j] * covariance(columns[j], port)) / varP : null,
      suggestedWeight: symbol === "CASH" ? cashWeight : tot > 0 ? ((1 - cashWeight) * inverse[j]) / tot : null
    }));
    const sectors = {};
    for (const h of pos) sectors[h.sector] = (sectors[h.sector] ?? 0) + h.weight;
    const correlations = Object.fromEntries(
      symbols.map((s, j) => [s, Object.fromEntries(symbols.map((k, l) => [k, corr(columns[j], columns[l])]))])
    );
    let wealth = 1,
      peak = 1,
      dd = 0;
    for (const r of port) {
      wealth *= 1 + r;
      peak = Math.max(peak, wealth);
      dd = Math.min(dd, wealth / peak - 1);
    }
    return {
      holdings: pos,
      totalValue,
      volatility: Math.sqrt(varP) * Math.sqrt(252),
      beta: quotient(covariance(port, benchmark), varBench),
      ...lossStats(port),
      maxDrawdown: dd,
      correlation: correlations,
      sectors,
      n: port.length,
      date: dates[indexes.at(-1)],
      warnings: [
        "按当前权重每日再平衡回看风险，计算共同交易日收盘到收盘复权收益，现金收益设为零。VaR 与 ES 为一日 95% 历史损失。单项风险贡献为加权边际方差占比。",
        "参考配置固定原现金比例，其余按波动率倒数分配，不考虑税务、换手与行业上限。共同有效交易日 " +
          port.length +
          " / 请求 " +
          lookback +
          "。"
      ]
    };
  }
  function simulate(holdings, opts = {}) {
    const priceOnly = opts.priceOnly === true;
    const { symbols, w, returns, indexes } = prepareHoldings(holdings, opts, priceOnly);
    if (priceOnly && (symbols.length !== 1 || symbols[0] === "CASH"))
      throw Error("美元目标股价需选择单一股票或 ETF。");
    const days = bound(Number(opts.days ?? 63), 1, 756, "模拟天数", true),
      paths = bound(Number(opts.paths ?? 1000), 100, 20000, "路径数", true);
    const block = bound(Number(opts.block ?? 5), 1, 63, "抽样区块长度", true),
      barrier = bound(Number(opts.targetReturn ?? 0.1), -0.99999, 100, "目标收益");
    const seed = bound(Number(opts.seed ?? 17), 0, 4294967295, "随机种子", true);
    if (paths * days * symbols.length > 1.6e8)
      throw Error("此参数组合超过单次计算上限，请缩短模拟期、路径数或股票数量。");
    const starts = indexes
      .map((_, i) => i)
      .filter((i) => i + block <= indexes.length && indexes[i + block - 1] - indexes[i] === block - 1);
    if (starts.length < 2) throw Error("共同历史中没有足够的连续区块，请缩短区块长度。");
    let state = seed >>> 0;
    function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const pathsByDay = Array.from({ length: days + 1 }, () => new Float64Array(paths));
    const drawdowns = new Float64Array(paths);
    let hit = 0,
      losers = 0;
    for (let path = 0; path < paths; path++) {
      const position = [...w];
      let peak = 1,
        dd = 0,
        idx = 0,
        targetHit = barrier === 0;
      for (let j = 1; j <= days; j++) {
        if ((j - 1) % block === 0) idx = starts[Math.floor(random() * starts.length)];
        const rets = returns[idx++];
        let v = 0;
        for (let k = 0; k < symbols.length; k++) {
          position[k] *= 1 + rets[k];
          v += position[k];
        }
        const gain = v - 1;
        pathsByDay[j][path] = gain;
        peak = Math.max(peak, v);
        dd = Math.min(dd, v / peak - 1);
        if (barrier >= 0 ? gain >= barrier : gain <= barrier) targetHit = true;
      }
      if (targetHit) hit++;
      if (pathsByDay[days][path] < 0) losers++;
      drawdowns[path] = dd;
    }
    const pctSorted = (a, p) => {
      const n = (a.length - 1) * p,
        lo = Math.floor(n);
      return a[lo] + (n - lo) * (a[Math.min(lo + 1, a.length - 1)] - a[lo]);
    };
    const bands = pathsByDay.map((r, day) => {
      r.sort();
      return {
        day,
        p05: pctSorted(r, 0.05),
        p25: pctSorted(r, 0.25),
        p50: pctSorted(r, 0.5),
        p75: pctSorted(r, 0.75),
        p95: pctSorted(r, 0.95)
      };
    });
    const terminal = Array.from(pathsByDay[days]),
      low = terminal[0],
      high = terminal.at(-1),
      bins = high === low ? 1 : 18;
    const width = (high - low) / bins;
    const distribution = Array.from({ length: bins }, (_, i) => ({
      low: low + i * width,
      high: i === bins - 1 ? high : low + (i + 1) * width,
      count: 0
    }));
    for (const r of terminal)
      distribution[width ? Math.min(bins - 1, Math.floor((r - low) / width)) : 0].count++;
    return {
      bands,
      distribution,
      pLoss: losers / paths,
      pTarget: hit / paths,
      ...lossStats(terminal),
      medianDrawdown: quantile(drawdowns, 0.5),
      worstDrawdown95: quantile(drawdowns, 0.05),
      median: bands.at(-1).p50,
      n: returns.length,
      paths,
      seed,
      days,
      block,
      priceOnly,
      warnings: [
        priceOnly
          ? "目标价模式使用仅调整拆股的收盘价变动，不计现金分红。"
          : "收益目标模式使用包括现金分红再投资的复权收益。",
        "从共同历史收益中有放回抽取连续区块，所有资产同步抽样，按初始权重买入持有。目标概率按路径中任一日收盘触及计算，亏损概率按期末判断。历史分布在未来保持代表性是关键假设。未计模拟期间税费和进出成本。"
      ]
    };
  }
  return { dates, rank, stock, regime, research, backtest, learn, portfolio, simulate };
}
