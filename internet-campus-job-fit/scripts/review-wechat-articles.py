#!/usr/bin/env python3
"""Incrementally inspect archived WeChat recruitment articles for second-hop URLs and images."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html as html_lib
import json
import re
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
# Limit extraction to URL-safe ASCII.  Recruitment articles often place Chinese
# prose immediately after a URL without whitespace; a permissive pattern would
# accidentally absorb that prose into the hostname/path.
URL_RE = re.compile(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]+", re.I)
BOILERPLATE_HOSTS = {
    "badjs.weixinbridge.com", "wx.qlogo.cn", "unpkg.com", "ad.wx.com",
    "midas.gtimg.cn", "store.mp.video.tencent-cloud.com",
    "mmec-shop-1258344707.cos.ap-shanghai.myqcloud.com",
}
BLOCK_PATTERNS = {
    "environment_abnormal": "环境异常",
    "frequent_access": "访问过于频繁",
    "account_violation": "此内容因违规无法查看",
    "deleted": "该内容已被发布者删除",
    "not_found": "你访问的页面不存在",
}
thread_local = threading.local()


def session() -> requests.Session:
    value = getattr(thread_local, "session", None)
    if value is None:
        value = requests.Session()
        value.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"})
        thread_local.session = value
    return value


def normalize_url(value: str, base: str) -> str | None:
    value = html_lib.unescape(value or "").strip().replace("\\/", "/")
    if not value or value.startswith(("javascript:", "data:", "mailto:", "tel:")):
        return None
    if value.startswith("//"):
        value = "https:" + value
    try:
        parsed = urlparse(urljoin(base, value))
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return parsed.geturl()


def inspect(url: str, html_dir: Path, save_html: bool, timeout: int) -> dict:
    item = {"url": url, "checked_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}
    try:
        response = session().get(url, timeout=timeout, allow_redirects=True)
        content = response.content
        # WeChat article HTML declares UTF-8, while requests often guesses
        # ISO-8859-1 because the Content-Type header omits the charset.
        text = content.decode("utf-8", "replace") if content else ""
        sha = hashlib.sha256(content).hexdigest()
        item.update({"http_status": response.status_code, "final_url": response.url, "content_type": response.headers.get("content-type", ""), "bytes": len(content), "response_sha256": sha})
        if save_html and content:
            target = html_dir / f"{sha}.html.gz"
            if not target.exists():
                with gzip.open(target, "wb", compresslevel=6) as fh:
                    fh.write(content)
            item["html_file"] = str(target)
        blocked = next((key for key, pattern in BLOCK_PATTERNS.items() if pattern in text), None)
        soup = BeautifulSoup(text, "html.parser")
        title = ""
        for selector, attr in [("meta[property='og:title']", "content"), ("meta[name='twitter:title']", "content"), ("title", None)]:
            node = soup.select_one(selector)
            if node:
                title = (node.get(attr, "") if attr else node.get_text(" ", strip=True)).strip()
                if title:
                    break
        article = soup.select_one("#js_content")
        body_text = article.get_text("\n", strip=True) if article else ""
        link_values, image_values = [], []
        scope = article or soup
        for node in scope.find_all(True):
            for attr in ("href", "data-link", "data-url", "data-origin-url"):
                if node.has_attr(attr):
                    link_values.append(node.get(attr))
            if node.name in {"img", "source"}:
                for attr in ("data-src", "src", "data-original", "data-backsrc"):
                    if node.has_attr(attr):
                        image_values.append(node.get(attr))
        decoded = html_lib.unescape(text).replace("\\/", "/")
        link_values.extend(URL_RE.findall(body_text))
        # Raw source can contain official links encoded in JSON rather than rendered anchors.
        link_values.extend(URL_RE.findall(decoded))
        links, images = [], []
        for raw in link_values:
            value = normalize_url(raw, response.url)
            if value and value not in links:
                links.append(value)
        for raw in image_values:
            value = normalize_url(raw, response.url)
            if value and value not in images:
                images.append(value)
        external = []
        for value in links:
            host = (urlparse(value).hostname or "").lower()
            if (
                host in BOILERPLATE_HOSTS
                or host == "__bridge_loaded__"
                or host == "|https"
                or host == "qq.com"
                or host.endswith((".weixin.qq.com", ".qq.com", ".qpic.cn"))
                or host == "www.w3.org"
            ):
                continue
            external.append(value)
        item.update({"title": title, "article_body_found": bool(article), "body_chars": len(body_text), "blocked_reason": blocked, "outgoing_urls": external, "all_http_urls_count": len(links), "image_urls": images})
        if blocked:
            item["state"] = "blocked"
        elif article and len(body_text) > 30:
            item["state"] = "article_read"
        elif article and images:
            item["state"] = "article_image_only"
        else:
            item["state"] = "non_article_or_empty"
    except Exception as exc:  # preserve every failed URL for a later retry
        item.update({"state": "request_failed", "error": str(exc), "outgoing_urls": [], "image_urls": []})
    return item


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("unique_links_csv", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--save-html", action="store_true")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    html_dir = args.output_dir / "html"
    if args.save_html:
        html_dir.mkdir(exist_ok=True)
    output = args.output_dir / "articles.jsonl"
    completed: set[str] = set()
    if output.exists():
        for line in output.read_text(encoding="utf-8").splitlines():
            try:
                completed.add(json.loads(line)["url"])
            except Exception:
                pass
    with args.unique_links_csv.open(encoding="utf-8-sig", newline="") as fh:
        rows = [row for row in csv.DictReader(fh) if row.get("link_category") == "article"]
    urls = [row["url_normalized"] for row in rows if row["url_normalized"] not in completed]
    if args.limit:
        urls = urls[: args.limit]
    print(json.dumps({"article_urls": len(rows), "already_done": len(completed), "scheduled": len(urls)}, ensure_ascii=False), flush=True)
    done = 0
    with output.open("a", encoding="utf-8") as sink, ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(inspect, url, html_dir, args.save_html, args.timeout): url for url in urls}
        for future in as_completed(futures):
            result = future.result()
            sink.write(json.dumps(result, ensure_ascii=False) + "\n")
            sink.flush()
            done += 1
            if done % 100 == 0 or done == len(urls):
                print(json.dumps({"completed_this_run": done, "scheduled": len(urls), "last_state": result["state"]}, ensure_ascii=False), flush=True)
    all_rows = []
    for line in output.read_text(encoding="utf-8").splitlines():
        try:
            all_rows.append(json.loads(line))
        except Exception:
            pass
    states = Counter(row.get("state", "unknown") for row in all_rows)
    summary = {
        "article_urls": len(rows), "reviewed": len(all_rows), "state_counts": dict(states),
        "articles_with_external_urls": sum(bool(row.get("outgoing_urls")) for row in all_rows),
        "external_url_occurrences": sum(len(row.get("outgoing_urls", [])) for row in all_rows),
        "unique_external_urls": len({url for row in all_rows for url in row.get("outgoing_urls", [])}),
        "articles_with_images": sum(bool(row.get("image_urls")) for row in all_rows),
        "image_url_occurrences": sum(len(row.get("image_urls", [])) for row in all_rows),
    }
    (args.output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
