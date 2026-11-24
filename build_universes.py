"""Build on-demand index data matching the current local market snapshot. Python 3.10+."""
import concurrent.futures
import datetime as dt
import gzip
import json
import os
from pathlib import Path
import tempfile

from refresh import OUTPUT, SEC_MAP, UTC, collection_day, constituents, fetch, load_asset, norm


def write_archive(path, payload):
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as file:
        name = file.name
    try:
        with gzip.open(name, "wt", encoding="utf-8", compresslevel=6) as stream:
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False, separators=(",",":"))
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def earlier_estimates(folder, today):
    # Keep the dates that were actually collected across daily archive rebuilds.
    # Do not infer a past series from a newly observed 30-day comparison.
    saved = {}
    for group in ("nasdaq100", "sp500"):
        previous = folder / f"universe-{group}.json.gz"
        if not previous.exists():
            continue
        try:
            with gzip.open(previous, "rt", encoding="utf-8") as stream:
                payload = json.load(stream)
            for symbol, asset in payload.get("assets", {}).items():
                by_date = saved.setdefault(symbol, {})
                for estimate in asset.get("estimates", []):
                    if estimate.get("asOf", "") <= today:
                        by_date[estimate["asOf"]] = estimate
            del payload
        except (OSError, ValueError, KeyError) as exc:
            print(f"Historical estimate archive {group} unreadable: {exc}", flush=True)
    return {s:{"estimates":[dates[d] for d in sorted(dates)]} for s,dates in saved.items()}


def main():
    snapshot = json.loads(OUTPUT.read_text("utf-8"))
    now = dt.datetime.now(UTC)
    today = collection_day(now)
    if snapshot["universeInfo"]["constituentsObserved"] != today:
        raise SystemExit("Refresh market.json first. The index archives must share its observation day.")
    projected = {group:sorted(snapshot["universes"][group]) for group in ("sp500","nasdaq100")}
    profiles, sp, nd = constituents()
    if projected != {"sp500":sp,"nasdaq100":nd}:
        raise SystemExit("Constituents have changed. Refresh market.json before building new archives.")
    for row in json.loads(fetch(SEC_MAP)).values():
        s = norm(row["ticker"])
        if s in profiles:
            profiles[s].setdefault("cik", int(row["cik_str"]))
    cutoff = snapshot["asOf"]
    assets = {s:a for s,a in snapshot["assets"].items() if a["type"]=="stock" and a["prices"][-1][0] == cutoff}
    missing = sorted((set(sp)|set(nd)) - set(assets))
    errors = {}
    print(f"Reading {len(missing)} additional symbols for {cutoff}.", flush=True)

    def save_ready(group):
        # Check identity again before publishing a long-running build.
        current = json.loads(OUTPUT.read_text("utf-8"))
        if current["generatedAt"] != snapshot["generatedAt"]:
            raise RuntimeError("Base snapshot changed while building archives. Run build_universes.py again.")
        members = projected[group]
        covered = {s:assets[s] for s in members if s in assets}
        result = {"schemaVersion":1,"pool":group,"asOf":cutoff,"observedDate":today,
                  "members":members,"assets":covered,"issues":[msg for s in members for msg in errors.get(s,[])]}
        write_archive(OUTPUT.parent / f"universe-{group}.json.gz", result)
        print(f"{group}: {len(covered)}/{len(members)} on the benchmark date.", flush=True)

    # Submit the smaller index first so it can be shipped and tested early.
    missing.sort(key=lambda s:(s not in nd, s))
    remaining = {k:set(v) & set(missing) for k,v in projected.items()}
    saved = set()
    old = earlier_estimates(OUTPUT.parent, today)
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        jobs = {pool.submit(load_asset,s,profiles[s],old.get(s,{}),now,today):s for s in missing}
        for i, job in enumerate(concurrent.futures.as_completed(jobs), 1):
            s = jobs[job]
            try:
                asset, warnings = job.result()
                errors[s] = warnings
                if asset["prices"][-1][0] == cutoff:
                    assets[s] = asset
                else:
                    errors[s].append(f"{s}: latest quote {asset['prices'][-1][0]} differs from benchmark date {cutoff}")
            except Exception as exc:
                errors[s] = [f"{s}: {exc}"]
            for group,waiting in remaining.items():
                waiting.discard(s)
                if not waiting and group not in saved:
                    save_ready(group)
                    saved.add(group)
            if i % 50 == 0:
                print(f"{i}/{len(missing)} checked", flush=True)
    for group in projected:
        if group not in saved:
            save_ready(group)


if __name__ == "__main__":
    main()
