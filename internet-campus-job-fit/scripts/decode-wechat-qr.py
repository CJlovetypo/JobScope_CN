#!/usr/bin/env python3
"""Download deduplicated WeChat article images and decode QR codes incrementally."""
from __future__ import annotations

import argparse
import hashlib
import json
import threading
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
thread_local = threading.local()


def session() -> requests.Session:
    value = getattr(thread_local, "session", None)
    if value is None:
        value = requests.Session()
        value.headers.update({"User-Agent": UA, "Referer": "https://mp.weixin.qq.com/"})
        thread_local.session = value
    return value


def decode_qr(image: np.ndarray) -> list[str]:
    detector = cv2.QRCodeDetector()
    values: list[str] = []
    try:
        ok, decoded, _points, _straight = detector.detectAndDecodeMulti(image)
        if ok:
            values.extend(value.strip() for value in decoded if value and value.strip())
    except Exception:
        pass
    if not values:
        try:
            value, _points, _straight = detector.detectAndDecode(image)
            if value and value.strip():
                values.append(value.strip())
        except Exception:
            pass
    # A QR may be too small in a large poster. Retry common enlarged and
    # center/bottom crops where recruitment QR codes are frequently placed.
    h, w = image.shape[:2]
    if not values and max(h, w) >= 900:
        crops = [image[h // 2 :, :], image[:, w // 2 :], image[h // 2 :, w // 2 :]]
        for crop in crops:
            try:
                value, _points, _straight = detector.detectAndDecode(crop)
                if value and value.strip():
                    values.append(value.strip())
            except Exception:
                continue
    return list(dict.fromkeys(values))


def inspect(url: str, article_urls: list[str], timeout: int, max_bytes: int, evidence_dir: Path) -> dict:
    item = {"image_url": url, "article_urls": article_urls}
    try:
        response = session().get(url, timeout=timeout, allow_redirects=True, stream=True)
        item.update({"http_status": response.status_code, "final_url": response.url, "content_type": response.headers.get("content-type", "")})
        response.raise_for_status()
        content = bytearray()
        for chunk in response.iter_content(65536):
            content.extend(chunk)
            if len(content) > max_bytes:
                item.update({"state": "too_large", "bytes": len(content)})
                return item
        raw = bytes(content)
        sha = hashlib.sha256(raw).hexdigest()
        item.update({"bytes": len(raw), "sha256": sha})
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            item["state"] = "decode_failed"
            return item
        h, w = image.shape[:2]
        item.update({"width": w, "height": h})
        if w < 120 or h < 120:
            item["state"] = "too_small"
            return item
        values = decode_qr(image)
        item["qr_values"] = values
        item["state"] = "qr_found" if values else "no_qr"
        if values:
            suffix = Path(urlparse(response.url).path).suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                suffix = ".bin"
            target = evidence_dir / f"{sha}{suffix}"
            if not target.exists():
                target.write_bytes(raw)
            item["evidence_file"] = str(target)
    except Exception as exc:
        item.update({"state": "request_failed", "error": str(exc)})
    return item


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("articles_jsonl", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--max-bytes", type=int, default=10_000_000)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    evidence_dir = args.output_dir / "positive-evidence"
    evidence_dir.mkdir(exist_ok=True)
    image_articles: dict[str, list[str]] = defaultdict(list)
    for line in args.articles_jsonl.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        for image_url in row.get("image_urls", []):
            if row.get("url") not in image_articles[image_url]:
                image_articles[image_url].append(row.get("url"))
    output = args.output_dir / "images.jsonl"
    completed: set[str] = set()
    if output.exists():
        for line in output.read_text(encoding="utf-8").splitlines():
            try:
                completed.add(json.loads(line)["image_url"])
            except Exception:
                pass
    jobs = [(url, origins) for url, origins in image_articles.items() if url not in completed]
    if args.limit:
        jobs = jobs[: args.limit]
    print(json.dumps({"unique_images": len(image_articles), "already_done": len(completed), "scheduled": len(jobs)}, ensure_ascii=False), flush=True)
    done = 0
    with output.open("a", encoding="utf-8") as sink, ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(inspect, url, origins, args.timeout, args.max_bytes, evidence_dir): url for url, origins in jobs}
        for future in as_completed(futures):
            result = future.result()
            sink.write(json.dumps(result, ensure_ascii=False) + "\n")
            sink.flush()
            done += 1
            if done % 100 == 0 or done == len(jobs):
                print(json.dumps({"completed_this_run": done, "scheduled": len(jobs), "last_state": result["state"]}, ensure_ascii=False), flush=True)
    rows = []
    for line in output.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
    summary = {
        "unique_images": len(image_articles),
        "reviewed": len(rows),
        "state_counts": dict(Counter(row.get("state", "unknown") for row in rows)),
        "images_with_qr": sum(row.get("state") == "qr_found" for row in rows),
        "unique_qr_values": len({value for row in rows for value in row.get("qr_values", [])}),
        "downloaded_bytes": sum(row.get("bytes", 0) for row in rows),
    }
    (args.output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
