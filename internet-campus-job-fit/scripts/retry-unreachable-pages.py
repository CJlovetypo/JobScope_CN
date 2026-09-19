#!/usr/bin/env python3
"""Retry failed recruitment pages with safe URL and transport variants."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
LOCAL = threading.local()
ATS = re.compile(r"https?://[^\s\"'<>\\]+(?:mokahr\.com|zhiye\.com|hotjob\.cn|jobs\.feishu\.cn|jobs\.f\.mioffice\.cn)[^\s\"'<>\\]*", re.I)
API = re.compile(r"(?:(?:https?:)?//[^\s\"'<>\\]+)?/(?:api|gateway|student-api)/[A-Za-z0-9_./${}-]+", re.I)


def session() -> requests.Session:
    value = getattr(LOCAL, "session", None)
    if value is None:
        value = requests.Session()
        value.headers.update({"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"})
        LOCAL.session = value
    return value


def variants(url: str) -> list[str]:
    parsed = urlsplit(url)
    out = [url]
    if parsed.scheme in {"http", "https"}:
        out.append(urlunsplit(("https" if parsed.scheme == "http" else "http", parsed.netloc, parsed.path, parsed.query, "")))
        out.append(urlunsplit((parsed.scheme, parsed.netloc, "/", "", "")))
        if parsed.hostname and parsed.hostname.startswith("m."):
            netloc = parsed.netloc[2:]
            out.append(urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, "")))
        if ".m.zhiye.com" in parsed.netloc:
            out.append(url.replace(".m.zhiye.com", ".zhiye.com"))
    return list(dict.fromkeys(out))


def review(item: dict, timeout: int, evidence: Path) -> dict:
    attempts = []
    for entry in item.get("entry_urls") or []:
        for target in variants(entry):
            try:
                response = session().get(target, timeout=timeout, allow_redirects=True, verify=True)
                raw = response.content
                content_type = response.headers.get("content-type", "")
                text = response.text[:5_000_000]
                attempt = {"url": target, "http_status": response.status_code, "final_url": response.url,
                           "content_type": content_type, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                attempts.append(attempt)
                readable = 200 <= response.status_code < 400 and len(raw) >= 200
                if readable:
                    api_hints = sorted(set(API.findall(text)))[:200]
                    ats_links = sorted(set(ATS.findall(text)))[:50]
                    suffix = ".json" if "json" in content_type else ".html"
                    file = evidence / (attempt["sha256"] + suffix)
                    if not file.exists(): file.write_bytes(raw)
                    return {**item, "state": "recovered", "recovered_url": response.url, "response_file": str(file),
                            "api_hints": api_hints, "ats_links": ats_links, "attempts_v2": attempts}
            except Exception as exc:
                attempts.append({"url": target, "error": str(exc)})
    statuses = [a.get("http_status") for a in attempts if a.get("http_status") is not None]
    return {**item, "state": "still_unreachable", "http_statuses": statuses, "attempts_v2": attempts}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--concurrency", type=int, default=12)
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    evidence = args.output / "responses"; evidence.mkdir(exist_ok=True)
    source = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    # A later review must be able to consume the previous review directly.
    # Earlier versions only accepted the initial `unreachable` state, which
    # silently turned a second pass over `still_unreachable` rows into a
    # zero-item run.
    items = [item for item in source if item.get("state") in {"unreachable", "still_unreachable"}]
    rows = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(review, item, args.timeout, evidence): item for item in items}
        for index, future in enumerate(as_completed(futures), 1):
            rows.append(future.result())
            if index % 20 == 0: print(json.dumps({"completed": index, "scheduled": len(items)}), flush=True)
    rows.sort(key=lambda row: row.get("display_name", ""))
    (args.output / "manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    counts = Counter(row["state"] for row in rows)
    summary = {"reviewed": len(rows), "state_counts": dict(counts), "recovered_with_api_hints": sum(bool(row.get("api_hints")) for row in rows),
               "recovered_with_ats_links": sum(bool(row.get("ats_links")) for row in rows)}
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
