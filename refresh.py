"""Refresh AlphaLens public-source research data. Python 3.10+, standard library only."""
import argparse
import concurrent.futures
import csv
import datetime as dt
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "dist" / "data" / "market.json"
SAMPLE = """AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO AMD INTC QCOM ORCL CRM ADBE IBM CSCO TXN AMAT
JPM BAC GS V MA AXP BLK UNH JNJ LLY PFE MRK ABBV TMO AMGN COST WMT PG KO PEP MCD SBUX NKE HD LOW
CAT DE HON UPS UNP LMT RTX GE XOM CVX COP SLB NEE SO DUK PLD AMT EQIX LIN APD NEM NFLX DIS CMCSA""".split()
MAG7 = "AAPL MSFT NVDA GOOGL AMZN META TSLA".split()
BENCH = {"SPY":"SPDR S&P 500 ETF Trust","QQQ":"Invesco QQQ Trust","DIA":"SPDR Dow Jones Industrial Average ETF Trust","IWM":"iShares Russell 2000 ETF"}
INDICES = {"^GSPC":"S&P 500","^NDX":"Nasdaq 100","^DJI":"Dow Jones Industrial Average","^VIX":"CBOE Volatility Index"}
BASE = {**BENCH, **INDICES}
SP_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv"
NDX_URL = "https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies"
SEC_MAP = "https://www.sec.gov/files/company_tickers.json"
MAG7_URL = "https://blog.roundhillinvestments.com/how-to-gain-exposure-to-the-magnificent-7"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"
START = dt.date(2018, 1, 1)
SEC_AGENT = os.environ.get("SEC_USER_AGENT", "AlphaLens Research " + (os.environ.get("USERNAME") or "individual-investor"))
SEC_LIMIT = threading.Lock()
NEXT_SEC = 0.0
UTC = dt.timezone.utc


def fetch(url):
    """Limit SEC traffic across all download threads; never retry a denied request."""
    global NEXT_SEC
    for attempt in range(3):
        if "sec.gov/" in url:
            with SEC_LIMIT:
                time.sleep(max(0, NEXT_SEC - time.monotonic()))
                NEXT_SEC = time.monotonic() + 0.24
        ua = SEC_AGENT if "sec.gov/" in url else "Mozilla/5.0 (compatible; AlphaLens/1.0; investment research)"
        request = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(request, timeout=22) as response:
                return response.read().decode("utf-8-sig")
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep(max(2 ** attempt, min(45, int(exc.headers.get("Retry-After", "1"))) if str(exc.headers.get("Retry-After", "")).isdigit() else 1))
        except (TimeoutError, OSError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def norm(s):
    return s.upper().strip().replace(".", "-")


def constituents():
    stocks = {}
    for r in csv.DictReader(io.StringIO(fetch(SP_URL))):
        s = norm(r["Symbol"])
        stocks[s] = {"name":r["Security"], "sector":r["GICS Sector"], "cik":int(r["CIK"])}
    if not 470 <= len(stocks) <= 550 or "AAPL" not in stocks:
        raise ValueError("Unexpected S&P 500 constituent schema")
    sp = sorted(stocks)
    listing = fetch(NDX_URL)
    nd = set()
    for table in re.findall(r"<table\b.*?</table>", listing, re.S):
        rows = re.findall(r"<tr\b.*?</tr>", table, re.S)
        if not rows:
            continue
        def cells(r):
            return [html.unescape(re.sub("<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", r, re.S)]
        headers = cells(rows[0])
        if "Ticker" not in headers or "Company" not in headers:
            continue
        for row in rows[1:]:
            cols = cells(row)
            if len(cols) != len(headers):
                continue
            s = norm(cols[headers.index("Ticker")])
            if not re.fullmatch(r"[A-Z0-9-]{1,12}", s):
                continue
            nd.add(s)
            # GICS and ICB are different classifications. Avoid mixing their labels.
            stocks.setdefault(s, {"name":cols[headers.index("Company")], "sector":"Unclassified"})
        break
    if not 85 <= len(nd) <= 115 or "AAPL" not in nd:
        raise ValueError("Unexpected Nasdaq 100 constituent schema")
    return stocks, sp, sorted(nd)


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def iso(ts):
    return dt.datetime.fromtimestamp(ts, UTC).date().isoformat()


def price_data(s, now):
    start = int(dt.datetime.combine(START, dt.time.min, UTC).timestamp())
    query = urllib.parse.urlencode({"period1":start, "period2":int(now.timestamp()), "interval":"1d", "events":"splits"})
    url = CHART + urllib.parse.quote(s) + "?" + query
    payload = json.loads(fetch(url))["chart"]["result"][0]
    meta = payload["meta"]
    if norm(meta["symbol"]) != s or meta.get("currency") != "USD":
        raise ValueError("Ticker or USD currency mismatch")
    q = payload["indicators"]["quote"][0]
    adj = payload["indicators"].get("adjclose", [{}])[0].get("adjclose")
    if adj is None and s not in INDICES:
        raise ValueError("Missing adjusted close")
    today = iso(now.timestamp())
    regular = meta.get("currentTradingPeriod", {}).get("regular", {})
    indexed = {}
    for ts, ac, px, volume in zip(payload["timestamp"], (adj if adj is not None else q["close"]), q["close"], q["volume"]):
        date = iso(ts)
        if date == today:
            # The US regular session ends no later than 21:00 UTC. Use a conservative cutoff
            # when the regular-session metadata belongs to a different day.
            end_time = regular.get("end", 0)
            if iso(end_time) != today:
                end_time = int(now.replace(hour=21, minute=0, second=0, microsecond=0).timestamp())
            if now.timestamp() < end_time + 60:
                continue
        if date > today or not all(number(v) and v > 0 for v in (ac, px)):
            continue
        indexed[date] = [date, round(ac, 6), round(px, 6), int(volume) if number(volume) and volume >= 0 else None]
    if len(indexed) < 2:
        raise ValueError("Insufficient valid observations")
    splits = []
    for event in payload.get("events", {}).get("splits", {}).values():
        ratio = event["numerator"] / event["denominator"]
        if not number(ratio) or ratio <= 0:
            raise ValueError("Invalid split ratio")
        if iso(event["date"]) <= max(indexed):
            splits.append([iso(event["date"]), ratio])
    return {"prices":[indexed[k] for k in sorted(indexed)], "splits":sorted(splits),
            "priceSource":url, "name":meta.get("longName") or meta.get("shortName") or s}


TAGS = {
    "revenue":("RevenuesNetOfInterestExpense","Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","SalesRevenueNet","RevenueFromContractWithCustomerIncludingAssessedTax"),
    "netIncome":("NetIncomeLoss","ProfitLoss"),
    "assets":("Assets",),
    "equity":("StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "liabilities":("Liabilities",),
    "eps":("EarningsPerShareDiluted","IncomeLossFromContinuingOperationsPerDilutedShare"),
    "shares":("WeightedAverageNumberOfDilutedSharesOutstanding",),
    "operatingIncome":("OperatingIncomeLoss",),
    "operatingCashFlow":("NetCashProvidedByUsedInOperatingActivities",),
}
INSTANT = {"assets","equity","liabilities"}


def financials(cik, splits, today):
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
    root = json.loads(fetch(url))["facts"].get("us-gaap", {})
    rows = {}
    for field, tags in TAGS.items():
        unit = {"eps":"USD/shares", "shares":"shares"}.get(field, "USD")
        for tag in tags:
            facts = root.get(tag, {}).get("units", {}).get(unit, [])
            for fact in facts:
                end = fact["end"]
                filed = fact["filed"]
                if fact["form"] != "10-K" or filed > today or end < "2015-01-01" or not number(fact["val"]):
                    continue
                # Exclude prior-period comparisons filed in a more recent report.
                delay = (dt.date.fromisoformat(filed) - dt.date.fromisoformat(end)).days
                if not 0 < delay <= 210:
                    continue
                start = fact.get("start")
                if field in INSTANT:
                    if start:
                        continue
                elif not start or not 330 <= (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days <= 380:
                    continue
                key = (end, filed, fact["accn"])
                record = rows.setdefault(key, {"filed":filed, "periodEnd":end, "accession":fact["accn"], "tags":{}})
                if field not in record:
                    record[field] = fact["val"]
                    record["tags"][field] = tag
                    if start:
                        record["periodStart"] = start
    annual = []
    seen = set()
    for (end, filed, accession), row in sorted(rows.items()):
        if end in seen or "netIncome" not in row or "assets" not in row or "periodStart" not in row:
            continue
        seen.add(end)
        coeff = math.prod(ratio for date, ratio in splits if date > filed)
        # Companies normally give effect to completed splits through the issue date in EPS.
        # Pre-chart filing EPS cannot be verified against an incomplete action window.
        verified = filed >= START.isoformat()
        row["cik"] = cik
        filing_directory = accession.replace("-", "")
        row["source"] = f"https://www.sec.gov/Archives/edgar/data/{cik}/{filing_directory}/{accession}-index.html"
        row["epsSplitAdjusted"] = row["eps"] / coeff if verified and number(row.get("eps")) else None
        row["splitBasisVerified"] = verified
        # Fill only fields supported by facts; never derive liabilities from parent-only equity.
        for field in TAGS:
            row.setdefault(field, None)
        # An incorrectly scaled shares fact can corrupt share-based metrics by 10^3 or 10^6.
        # Suppress it rather than guessing a conversion not present in the filing.
        if row["shares"] and row["eps"] and row["netIncome"]:
            scale_check = abs(row["shares"] * row["eps"] / row["netIncome"])
            if scale_check < .01 or scale_check > 100:
                row["shares"] = None
                row["validation"] = "Diluted share count withheld: inconsistent SEC tagging or earnings basis."
        annual.append(row)
    return sorted(annual, key=lambda r:r["filed"])


def earnings(s, now, today):
    url = "https://finance.yahoo.com/quote/" + urllib.parse.quote(s) + "/analysis/"
    page = fetch(url)
    for attrs, text in re.findall(r"<script([^>]+)>(.*?)</script>", page, re.S):
        if "earningsTrend" not in attrs or "quoteSummary" not in attrs:
            continue
        response = json.loads(json.loads(text)["body"])["quoteSummary"]["result"][0]
        price = response.get("price", {})
        if norm(price.get("symbol", "")) != s:
            continue
        quote_time = price.get("regularMarketTime")
        if not number(quote_time) or quote_time > now.timestamp() + 60 or (now.timestamp() - quote_time) > 7*86400:
            raise ValueError("Page has an unverifiable or stale quote timestamp")
        trend = response.get("earningsTrendGaap", {})
        for item in trend.get("trend", []):
            if item.get("period") != "0y":
                continue
            eps = item.get("epsTrend", {})
            if eps.get("epsTrendCurrency") != "USD":
                continue
            current = eps.get("current", {}).get("raw")
            previous = eps.get("30daysAgo", {}).get("raw")
            if number(current) and number(previous):
                return {"asOf":today, "observedAt":now.isoformat(timespec="seconds"), "periodEnd":item["endDate"],
                        "forwardEPS":current,"previousForwardEPS":previous,"lookbackDays":30,
                        "analystCount":item.get("earningsEstimate",{}).get("numberOfAnalysts",{}).get("raw"),
                        "methodology":"FY0 GAAP consensus, USD/share", "source":url}
    raise ValueError("No dated USD FY0 GAAP consensus pair")


def collection_day(now):
    # The primary use is end-of-day research. Before 04:00 UTC the previous US date applies;
    # use the exchange timezone when the operating system ships IANA data.
    try:
        from zoneinfo import ZoneInfo
        return now.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    except (ImportError, KeyError):
        # US DST changes on the second Sunday in March and first Sunday in November.
        def sunday(month, first_day):
            d = dt.date(now.year, month, first_day)
            return d + dt.timedelta(days=(6-d.weekday())%7)
        summer = dt.datetime.combine(sunday(3, 8), dt.time(7), UTC) <= now < dt.datetime.combine(sunday(11, 1), dt.time(6), UTC)
        return (now - dt.timedelta(hours=4 if summer else 5)).date().isoformat()


def load_asset(s, profile, prior, now, today):
    warnings = []
    prices = price_data(s, now)
    kind = "etf" if s in BENCH else "index" if s in INDICES else "stock"
    obj = {**prices, "symbol":s, "name":BASE.get(s) or profile.get("name") or prices["name"],
           "sector":profile.get("sector", "Unclassified"), "cik":profile.get("cik"), "type":kind,
           "fundamentals":[], "estimates":prior.get("estimates", [])}
    if kind != "stock":
        return obj, warnings
    if obj["cik"]:
        try:
            obj["fundamentals"] = financials(obj["cik"], obj["splits"], today)
            if s == "XOM" and obj["cik"] == 2115436:
                # 1:1 successor as documented by the July 2026 SEC 8-K. Preserve original filing CIKs.
                predecessor = financials(34088, obj["splits"], today)
                obj["fundamentals"] = [row for row in predecessor if row["filed"] < "2026-07-01"] + obj["fundamentals"]
                obj["successorSource"] = "https://www.sec.gov/Archives/edgar/data/2115436/000119312526291990/d71068d8k12b.htm"
            if not obj["fundamentals"]:
                warnings.append(f"{s}: no matching original USD US-GAAP 10-K facts")
        except Exception as exc:
            obj["fundamentals"] = prior.get("fundamentals", []) if obj["splits"] == prior.get("splits") else []
            warnings.append(f"{s} SEC: {exc}")
    else:
        warnings.append(f"{s}: no CIK; fundamentals unavailable")
    try:
        estimate = earnings(s, now, today)
        # The last observation of a day is retained, and never backfilled to past days.
        obj["estimates"] = [e for e in obj["estimates"] if e["asOf"] != today] + [estimate]
    except Exception as exc:
        warnings.append(f"{s} consensus: {exc}")
    return obj, warnings


def macro_data(key, cutoff):
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + key
    out = []
    for row in csv.DictReader(io.StringIO(fetch(url))):
        date = row.get("observation_date") or row.get("DATE")
        if date and START.isoformat() <= date <= cutoff and row[key] not in ("", "."):
            val = float(row[key])
            if number(val):
                out.append([date, val])
    if not out:
        raise ValueError("No FRED observations")
    return out


def run(opt):
    now = dt.datetime.now(UTC)
    today = collection_day(now)
    prior = json.loads(OUTPUT.read_text("utf-8")) if OUTPUT.exists() else {}
    old_assets = prior.get("assets", {})
    profiles, sp, nd = constituents()
    issues = []
    try:
        for row in json.loads(fetch(SEC_MAP)).values():
            obj = profiles.setdefault(norm(row["ticker"]), {"name":row["title"], "sector":"Unclassified"})
            obj.setdefault("cik", int(row["cik_str"]))
    except Exception as exc:
        issues.append(f"SEC ticker map: {exc}")
    groups = {"sample":SAMPLE,"sp500":sp,"nasdaq100":nd,"all":sorted(set(sp) | set(nd)),
              "saved":[s for s,a in old_assets.items() if a["type"]=="stock"] or SAMPLE}
    extra = [norm(s) for s in (opt.symbols or "").split(",") if s.strip()]
    if any(not re.fullmatch(r"[A-Z0-9-]{1,12}",s) for s in extra):
        raise ValueError("Invalid ticker. Use comma-separated US symbols.")
    requested = sorted(set(groups[opt.universe]) | set(extra) | set(BASE) | set(MAG7))
    # Preserve existing coverage when expanding a custom universe.
    assets = dict(old_assets) if extra else {}
    if extra:
        requested = sorted(set(requested) | set(old_assets))
    print(f"Refreshing {len(requested)} assets; the previous snapshot stays available until validation.", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(load_asset,s,profiles.get(s,{}),old_assets.get(s,{}),now,today):s for s in requested}
        for n, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            s = futures[fut]
            try:
                assets[s], warning = fut.result()
                issues.extend(warning)
            except Exception as exc:
                if s in old_assets:
                    assets[s] = old_assets[s]
                issues.append(f"{s} prices: {exc}")
            if n % 15 == 0 or n == len(requested):
                print(f"{n}/{len(requested)} checked", flush=True)
    if any(s not in assets for s in (*MAG7, "SPY","QQQ")):
        raise RuntimeError("Required frozen-cohort or benchmark series missing; keeping previous snapshot")
    cutoff = assets["SPY"]["prices"][-1][0]
    if cutoff < prior.get("asOf",""):
        raise ValueError("Market date regressed; keeping previous snapshot")
    if not any(a["prices"] and a["prices"][-1][0] == cutoff and a["type"] == "stock" for a in assets.values()):
        raise ValueError("No stock closes on the benchmark date; keeping previous snapshot")
    macro = dict(prior.get("macro", {}))
    for key in ("DGS10","DGS2","VIXCLS"):
        try:
            macro[key] = macro_data(key, cutoff)
        except Exception as exc:
            issues.append(f"FRED {key}: {exc}")
    payload = {
        "schemaVersion":1,"asOf":cutoff,"generatedAt":now.isoformat(timespec="seconds"),
        "assets":dict(sorted(assets.items())),"universes":{"sample":[s for s in SAMPLE if s in assets],"sp500":sp,"nasdaq100":nd,"mag7":MAG7},
        "universeInfo":{"constituentsObserved":today, "mag7":{"usableFrom":"2024-01-02","published":"2023-11-16","source":MAG7_URL},
                        "requested":opt.universe,"requestedSymbols":requested},
        "macro":macro,"issues":sorted(issues),"sources":{
            "prices":"https://finance.yahoo.com/quote/SPY/history/","financials":"https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
            "estimates":"https://finance.yahoo.com/quote/AAPL/analysis/","macro":"https://fred.stlouisfed.org/series/DGS10",
            "sp500":SP_URL,"nasdaq100":NDX_URL,"mag7":MAG7_URL},
        "notes":{"prices":"USD. Date, distribution-and-split-adjusted close, split-adjusted close, volume. Index observations are index points.",
                 "financials":"First original annual 10-K, available only after filed. US-GAAP USD, diluted EPS USD/share, diluted weighted-average shares in units. Unavailable tags remain null. No quarterly interpolation.",
                 "estimates":"USD/share. Current fiscal year GAAP consensus versus the same fiscal year's estimate 30 days earlier, observed on capture date. A single observation is not a historical forecast archive.",
                 "macro":"FRED DGS10/DGS2 percentages and CBOE VIXCLS index points. Observation dates, latest vintage. Descriptive use only.",
                 "universes":"S&P and Nasdaq lists are current observed constituents with survivor bias when applied to the past. Historical research must use an independently dated frozen or point-in-time cohort."}}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=OUTPUT.parent, suffix=".tmp", delete=False) as temp:
        try:
            json.dump(payload, temp, ensure_ascii=False, allow_nan=False, separators=(",",":"))
            temp.flush()
            os.fsync(temp.fileno())
        except BaseException:
            temp.close()
            Path(temp.name).unlink(missing_ok=True)
            raise
    os.replace(temp.name, OUTPUT)
    print(f"Saved {len(assets)} assets through {cutoff}; {len(issues)} coverage notices.", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--universe", choices=("saved","sample","sp500","nasdaq100","all"), default="saved")
    p.add_argument("--symbols", help="Additional comma-separated US equity tickers")
    opt = p.parse_args()
    lock = Path(tempfile.gettempdir()) / ("alphalens-" + hashlib.sha256(str(OUTPUT).encode()).hexdigest()[:16] + ".lock")
    with lock.open("a+b") as handle:
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("Another refresh is running.", file=sys.stderr)
            return 2
        run(opt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

