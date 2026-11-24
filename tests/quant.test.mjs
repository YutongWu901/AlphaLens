// Isolated deterministic fixtures validate accounting and date boundaries.
// No fixture is loaded by the application.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngine } from "../dist/quant.js";

const dates = [];
for (let t = Date.UTC(2021, 0, 1); dates.length < 650; t += 86400000) {
  const d = new Date(t);
  if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
}
function fixture() {
  const assets = {};
  const syms = ["TEST_A", "TEST_B", "TEST_C", "TEST_D", "TEST_E"];
  for (const [index, symbol] of [...syms, "SPY", "QQQ"].entries()) {
    let p = 10;
    const prices = dates.map((d, i) => {
      p *= 1 + 0.0001 * (1 + index) + 0.002 * Math.sin(i / 13 + 0.1 * index);
      return [d, p, p, 10000 + i];
    });
    assets[symbol] = {
      symbol,
      sector: "TEST",
      type: syms.includes(symbol) ? "stock" : "etf",
      prices,
      fundamentals: [
        {
          filed: dates[260],
          periodEnd: dates[240],
          netIncome: index + 1,
          revenue: 100,
          epsSplitAdjusted: index + 1,
          assets: 200,
          liabilities: 50
        }
      ],
      estimates: []
    };
  }
  return { asOf: dates.at(-1), assets, universes: { sample: syms } };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `Expected ${a} ≈ ${b}`);
test("annual filing first activates after its filing date", () => {
  const q = createEngine(fixture());
  assert.equal(
    q.rank({ asOf: dates[260] }).every((r) => r.raw.quality === null),
    true
  );
  assert.equal(
    q.rank({ asOf: dates[261] }).every((r) => r.raw.quality > 0),
    true
  );
});
test("current after-close estimates are isolated from historical signals and cached observations", () => {
  const a = fixture(),
    stock = a.assets.TEST_A;
  stock.estimates = [{ asOf: dates.at(-1), forwardEPS: 1.1, previousForwardEPS: 1, periodEnd: "2030-12-31" }];
  const q = createEngine(a);
  const observed = (opts) => q.rank(opts).find((row) => row.symbol === "TEST_A").raw.earnings;
  assert.equal(observed({}), null);
  near(observed({ afterClose: true }), 0.1);
  assert.equal(observed({ asOf: dates.at(-2), afterClose: true }), null);
  assert.equal(observed({}), null);
});
test("changing future prices and future financial data cannot affect historical ranks", () => {
  const a = fixture(),
    b = structuredClone(a);
  for (const asset of Object.values(b.assets)) {
    for (let i = 400; i < dates.length; i++) {
      asset.prices[i][1] *= 20;
      asset.prices[i][2] *= 20;
    }
    asset.fundamentals.push({
      filed: dates[420],
      periodEnd: dates[395],
      revenue: 1e7,
      netIncome: 100,
      epsSplitAdjusted: 50
    });
  }
  const opts = { asOf: dates[399] };
  assert.deepEqual(createEngine(a).rank(opts), createEngine(b).rank(opts));
});
test("prior signal, next close fill, costs on actual notional, and buy-and-hold drift", () => {
  const a = fixture(),
    q = createEngine(a),
    start = 300,
    opts = {
      weights: { quality: 1 },
      start: dates[start],
      end: dates[start + 4],
      frequency: "quarterly",
      count: 2,
      feeBps: 20,
      slippageBps: 10
    };
  const run = q.backtest(opts),
    selected = run.trades[0].symbols;
  assert.equal(run.trades.length, 1);
  assert.deepEqual(selected, ["TEST_E", "TEST_D"]);
  assert.equal(run.trades[0].signalDate, dates[start]);
  assert.equal(run.trades[0].date, dates[start + 1]);
  const post = 1 / (1 + 0.003);
  near(run.curve[1].strategy, post);
  const final = selected.reduce(
    (v, s) => v + (0.5 * post * a.assets[s].prices[start + 4][1]) / a.assets[s].prices[start + 1][1],
    0
  );
  near(run.curve.at(-1).strategy, final);
});
test("weights, marginal risk, and inverse-volatility allocations reconcile", () => {
  const q = createEngine(fixture()),
    p = q.portfolio([
      { symbol: "TEST_A", shares: 20 },
      { symbol: "TEST_B", shares: 5 },
      { symbol: "CASH", shares: 30 }
    ]);
  for (const key of ["weight", "suggestedWeight", "contribution"])
    near(
      p.holdings.reduce((v, h) => v + h[key], 0),
      1
    );
  near(p.correlation.TEST_A.TEST_B, p.correlation.TEST_B.TEST_A);
  assert.equal(p.holdings[2].suggestedWeight, p.holdings[2].weight);
});
test("flat cash paths and deterministic synchronized bootstrap", () => {
  const q = createEngine(fixture());
  const flat = q.simulate([{ symbol: "CASH", weight: 1 }], { days: 7, paths: 100 });
  assert.equal(flat.pTarget, 0);
  assert.equal(flat.pLoss, 0);
  assert.equal(flat.var95, 0);
  assert.equal(flat.median, 0);
  const a = [
      { symbol: "TEST_A", weight: 0.8 },
      { symbol: "CASH", weight: 0.2 }
    ],
    opts = { seed: 44, days: 15, paths: 110, block: 3 };
  assert.deepEqual(q.simulate(a, opts), q.simulate(a, opts));
  const sim = q.simulate(a, opts);
  assert.equal(
    sim.distribution.reduce((v, b) => v + b.count, 0),
    opts.paths
  );
  assert.ok(sim.bands.every((b) => b.p05 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p95));
});
test("research computes real cross-sectional IC and training targets mature before testing", () => {
  const q = createEngine(fixture()),
    opts = { start: dates[270], end: dates[600], horizon: 10, weights: { momentum: 1 } };
  assert.ok(q.research(opts).factors.find((f) => f.key === "momentum").n > 12);
  for (const model of ["ridge", "quadratic"]) {
    const trained = q.learn({ ...opts, model });
    assert.ok(trained.folds.length > 3);
    assert.ok(trained.folds.every((f) => f.trainEnd < f.date));
    assert.ok(Object.values(trained.weights).every(Number.isFinite));
  }
});
test("a missing holding return aborts instead of silently removing that security", () => {
  const a = fixture();
  a.assets.TEST_E.prices.splice(303, 1);
  const q = createEngine(a);
  assert.throws(
    () => q.backtest({ start: dates[300], end: dates[305], weights: { quality: 1 }, count: 1 }),
    /TEST_E/
  );
});

test("a quoted-price barrier uses price return instead of reinvested distributions", () => {
  const a = fixture();
  const holdings = [{ symbol: "TEST_A", weight: 1 }];
  for (const bar of a.assets.TEST_A.prices) bar[2] = 10;
  const q = createEngine(a);
  const opts = { days: 20, paths: 100, targetReturn: 0.00001 };
  const price = q.simulate(holdings, { ...opts, priceOnly: true });
  assert.equal(price.pTarget, 0);
  assert.equal(price.median, 0);
  assert.ok(q.simulate(holdings, opts).pTarget > 0);
});
