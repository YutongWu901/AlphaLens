// Index archives are populated on first use and must match the base snapshot.
const active = new WeakMap();

function coverage(data, pool, loaded = 0, issues = []) {
  const symbols = data.universes[pool];
  const missing = symbols.filter(s => {
    const a = data.assets[s];
    return a?.type !== 'stock' || a.prices?.at(-1)?.[0] !== data.asOf;
  });
  return {covered:symbols.length-missing.length,total:symbols.length,loaded,missing,issues};
}

async function readArchive(data, pool) {
  const current = coverage(data, pool);
  if (!current.missing.length) return current;

  const res = await fetch(new URL('./data/universe-' + pool + '.json.gz', import.meta.url), {cache:'no-cache'});
  if (!res.ok) throw new Error('指数扩展数据未就绪。当前覆盖 ' + current.covered + '/' + current.total + '，请在本地生成对应日期的指数数据。');
  const buffer = await res.arrayBuffer();
  const prefix = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  let raw;
  if (prefix[0] === 31 && prefix[1] === 139) {
    if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持指数数据解压，请使用新版浏览器。');
    raw = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else {
    // Some hosts serve content-encoding: gzip, which fetch decompresses transparently.
    raw = new TextDecoder().decode(buffer);
  }
  let shard;
  try { shard = JSON.parse(raw); } catch { throw new Error('指数扩展文件格式无效。当前覆盖 ' + current.covered + '/' + current.total + '。'); }
  const symbols = new Set(data.universes[pool]);
  if (shard.schemaVersion !== 1 || shard.pool !== pool || shard.asOf !== data.asOf ||
      shard.observedDate !== data.universeInfo.constituentsObserved ||
      !Array.isArray(shard.members) || shard.members.length !== symbols.size ||
      new Set(shard.members).size !== symbols.size || !shard.members.every(s => symbols.has(s))) {
    throw new Error('指数扩展文件的行情日期、采集日期或成分名单与当前快照不一致。请重新生成扩展；当前覆盖 ' + current.covered + '/' + current.total + '。');
  }
  const additions = {};
  for (const [s, a] of Object.entries(shard.assets)) {
    if (!symbols.has(s) || a.symbol !== s || a.type !== 'stock' || a.prices?.at(-1)?.[0] !== data.asOf) {
      throw new Error('指数扩展数据校验失败。当前覆盖 ' + current.covered + '/' + current.total + '。');
    }
    if (!data.assets[s] || data.assets[s].prices?.at(-1)?.[0] !== data.asOf) additions[s] = a;
  }
  Object.assign(data.assets, additions);
  return coverage(data, pool, Object.keys(additions).length, shard.issues || []);
}

export async function loadUniverse(data, pool) {
  if (!['sp500', 'nasdaq100'].includes(pool)) throw new Error('未知指数股票池。');
  let jobs = active.get(data);
  if (!jobs) { jobs = new Map(); active.set(data, jobs); }
  if (jobs.has(pool)) return jobs.get(pool);
  const job = readArchive(data, pool).catch(error => { jobs.delete(pool); throw error; });
  jobs.set(pool, job);
  return job;
}
