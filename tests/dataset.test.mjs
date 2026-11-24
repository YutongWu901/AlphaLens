import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { createEngine } from "../dist/quant.js";

const folder = new URL("../dist/data/", import.meta.url);
const data = JSON.parse(readFileSync(new URL("market.json", folder)));
for (const key of ["sp500", "nasdaq100"]) {
  test(key + " archive matches the session and produces genuine cross-sectional rankings", () => {
    const compressed = readFileSync(new URL("universe-" + key + ".json.gz", folder));
    const shard = JSON.parse(gunzipSync(compressed));
    assert.equal(shard.pool, key);
    assert.equal(shard.observedDate, data.universeInfo.constituentsObserved);
    assert.equal(shard.asOf, data.asOf);
    assert.deepEqual(shard.members.toSorted(), data.universes[key].toSorted());
    const merged = { ...data, assets: { ...data.assets, ...shard.assets } };
    for (const [symbol, asset] of Object.entries(shard.assets)) {
      assert.equal(asset.type, "stock");
      assert.equal(asset.symbol, symbol);
      assert.equal(asset.prices.at(-1)[0], data.asOf);
      let previous = "";
      for (const [date, adjusted, close] of asset.prices) {
        assert.ok(date > previous && adjusted > 0 && close > 0, symbol + " " + date);
        previous = date;
      }
    }
    const rows = createEngine(merged).rank({ symbols: shard.members, afterClose: true });
    assert.ok(rows.length > 0);
    for (const r of rows) assert.ok(r.score === null || (r.score >= 0 && r.score <= 100 + 1e-10));
  });
}

