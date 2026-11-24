import { esc, pct, num, clr, ic } from "./graphics.js";
export function candidatePanel(rows) {
  function marginDiff(r) {
    const p = r.previousFundamental;
    return Number.isFinite(r.raw.quality) && p?.revenue > 0 && Number.isFinite(p.netIncome)
      ? r.raw.quality - p.netIncome / p.revenue
      : null;
  }
  const relevant = rows
    .filter((r) => r.drawdown <= -0.2)
    .sort(
      (a, b) =>
        Number(b.watch) - Number(a.watch) ||
        Number(b.watchCandidate) - Number(a.watchCandidate) ||
        a.drawdown - b.drawdown,
    );
  if (!relevant.length) return '<div class="card empty">当前可用股票均未触及 20% 年度回撤门槛。</div>';
  const content = relevant
    .map((r) => {
      const md = marginDiff(r);
      const signs = [
        r.raw.growth < 0 ? "收入下滑" : "",
        Number.isFinite(md) && md < -0.02 ? "利润率下行" : "",
        Number.isFinite(r.raw.earnings) && r.raw.earnings < -0.05 ? "盈利预期下修" : "",
      ].filter(Boolean);
      const tag = r.watch
        ? "错杀候选"
        : signs.length
          ? signs.join(" · ")
          : r.watchCandidate
            ? "预期待核实"
            : "估值或质量未达标";
      return (
        '<tr class="stock-row" tabindex="0" data-stock="' +
        esc(r.symbol) +
        '"><td><b class="num">' +
        esc(r.symbol) +
        '</b></td><td class="num negative">' +
        pct(r.drawdown, 1) +
        '</td><td class="num">' +
        pct(r.raw.growth, 1) +
        '</td><td class="num">' +
        (Number.isFinite(md) ? num(md * 100, 1) + " pp" : "—") +
        '</td><td class="num ' +
        clr(r.raw.earnings) +
        '">' +
        pct(r.raw.earnings, 1) +
        '</td><td><span class="tag ' +
        (r.watch ? "positive" : signs.length ? "negative" : "") +
        '">' +
        esc(tag) +
        "</span></td></tr>"
      );
    })
    .join("");
  return (
    '<section class="card rank-box" style="margin-top:15px"><div class="panel-head">' +
    ic("target") +
    '<h2 style="margin-right:auto">深度回撤公司对照</h2></div><p class="note" style="padding:0 18px 12px">对比 252 日高点回撤超过 20% 的公司。利润率变化以百分点（pp）计，一致预期修订比较同一财年 EPS 的 30 日变化。</p><div class="table-scroll"><table><thead><tr>' +
    ["股票", "距年度高点", "营收同比", "净利率变化", "EPS 预期修订", "筛查依据"]
      .map((x) => "<th>" + x + "</th>")
      .join("") +
    "</tr></thead><tbody>" +
    content +
    "</tbody></table></div></section>"
  );
}
