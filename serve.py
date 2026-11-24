"""AlphaLens local research service. Python 3.10+ standard library."""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from refresh import collection_day

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
MARKET = DIST / "data" / "market.json"
lock = threading.Lock()
status = {"running": False, "message": "数据服务就绪。"}
last_attempt = None


def fingerprint():
    return str(MARKET.stat().st_mtime_ns) if MARKET.exists() else None


def run_refresh(universe, symbols):
    cmd = [sys.executable, "-u", str(ROOT / "refresh.py"), "--universe", universe]
    if symbols:
        cmd.extend(["--symbols", ",".join(symbols)])
    commands = [(cmd, "基础快照"), ([sys.executable, "-u", str(ROOT / "build_universes.py")], "指数扩展")]
    try:
        for command, stage in commands:
            with subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                  errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"}) as proc:
                for line in proc.stdout:
                    with lock:
                        status["message"] = stage + " · " + line.strip()[:600]
                rc = proc.wait()
            if rc:
                with lock:
                    status["message"] = stage + "更新未完成。" + status["message"]
                return
        with lock:
            status["message"] = "基础快照与两个指数扩展已完成同步。"
    except Exception as exc:
        with lock:
            status["message"] = "更新未完成：" + str(exc)
    finally:
        with lock:
            status["running"] = False


def start_refresh(universe="saved", symbols=()):
    with lock:
        if status["running"]:
            return False
        status.update(running=True, message="正在连接原始数据源…")
    threading.Thread(target=run_refresh, args=(universe, symbols), daemon=True).start()
    return True


def scheduler():
    """Check for a new cash-market close after 17:15 New York. Retry transient failure hourly."""
    global last_attempt
    from refresh import UTC
    while True:
        now = dt.datetime.now(UTC)
        day = collection_day(now)
        # Date helper accepts UTC instants and accounts for US daylight saving time.
        past_cutoff = collection_day(now - dt.timedelta(hours=17, minutes=15)) == day
        if dt.date.fromisoformat(day).weekday() < 5 and past_cutoff and (
                last_attempt is None or time.time() - last_attempt > 3600):
            try:
                with MARKET.open(encoding="utf-8") as f:
                    snapshot = json.load(f)
                observed_at = dt.datetime.fromisoformat(snapshot["generatedAt"])
                refreshed_after_close = collection_day(observed_at - dt.timedelta(hours=17, minutes=15)) == day
                if snapshot["asOf"] < day and not refreshed_after_close and start_refresh():
                    last_attempt = time.time()
            except (OSError, ValueError, KeyError):
                if start_refresh():
                    last_attempt = time.time()
        time.sleep(300)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".gz": "application/gzip"}

    def json_response(self, code, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if urlsplit(self.path).path == "/api/status":
            with lock:
                current = dict(status)
            self.json_response(200, {**current, "service": "AlphaLens", "updated": fingerprint()})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != "/api/refresh":
            return self.json_response(404, {"message": "未知操作"})
        host = self.headers.get("Host", "")
        port = self.server.server_port
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}") or (
                self.headers.get("Origin", f"http://{host}") != f"http://{host}"):
            return self.json_response(403, {"message": "只接受本地同源请求"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8192 or self.headers.get_content_type() != "application/json":
                raise ValueError
            opts = json.loads(self.rfile.read(size))
            universe = opts.get("universe", "saved")
            symbols = opts.get("symbols", [])
            if universe not in ("saved", "sp500", "nasdaq100", "sample", "all") or not isinstance(symbols, list):
                raise ValueError
            if len(symbols) > 150 or any(not isinstance(s, str) or not re.fullmatch(r"[A-Z0-9-]{1,12}", s) for s in symbols):
                raise ValueError
        except (ValueError, AttributeError, TypeError):
            return self.json_response(400, {"message": "无效的同步范围或股票代码"})
        started = start_refresh(universe, symbols)
        self.json_response(202 if started else 409, {"message": "已开始同步。" if started else "已有同步任务正在运行。"})

    def list_directory(self, path):
        self.send_error(404)
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-auto-refresh", action="store_true")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(DIST)))
    url = f"http://127.0.0.1:{server.server_port}"
    print("AlphaLens " + url, flush=True)
    if not args.no_auto_refresh:
        threading.Thread(target=scheduler, daemon=True).start()
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

