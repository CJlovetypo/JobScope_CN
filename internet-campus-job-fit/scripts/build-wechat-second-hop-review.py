#!/usr/bin/env python3
"""Join WeChat article results back to WPS metadata and classify recovered links."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse


ATS = {
    "mokahr.com": "moka",
    "zhiye.com": "beisen",
    "jobs.feishu.cn": "feishu",
    "jobs.f.mioffice.cn": "feishu",
    "hotjob.cn": "hotjob",
    "51job.com": "51job",
    "zhaopin.com": "zhaopin",
    "nowcoder.com": "nowcoder",
    "workdayjobs.com": "workday",
    "myworkdayjobs.com": "workday",
    "greenhouse.io": "greenhouse",
    "smartrecruiters.com": "smartrecruiters",
}
NOISE = {
    "weixin.qq.com", "mp.weixin.qq.com", "support.weixin.qq.com", "channels.weixin.qq.com",
    "mmbiz.qpic.cn", "mmbizurl.cn", "res.wx.qq.com", "res2.wx.qq.com", "open.weixin.qq.com",
}
RECRUIT_WORDS = ("job", "jobs", "career", "careers", "campus", "recruit", "zhaopin", "hr", "join", "talent", "position")


def classify(url: str) -> tuple[str, str]:
    try:
        parsed = urlparse(url)
        host = parsed.hostname.lower() if parsed.hostname else ""
        low = url.lower()
    except Exception:
        return "invalid", ""
    if host in NOISE or host.endswith(".weixin.qq.com") or host.endswith(".qpic.cn"):
        return "wechat_noise", ""
    for suffix, provider in ATS.items():
        if host == suffix or host.endswith("." + suffix):
            return "recognized_ats", provider
    if low.endswith((".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip")):
        return "attachment", ""
    if any(word in host or word in parsed.path.lower() for word in RECRUIT_WORDS):
        return "possible_recruitment", ""
    return "other", ""


def read_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("unique_links_csv", type=Path)
    parser.add_argument("articles_jsonl", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    with args.unique_links_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        source = {row["url_normalized"]: row for row in csv.DictReader(handle)}

    rows = []
    by_link: dict[str, dict] = {}
    state_counts = Counter()
    for article in read_jsonl(args.articles_jsonl):
        state_counts[article.get("state", "unknown")] += 1
        meta = source.get(article["url"], {})
        for target in article.get("outgoing_urls") or []:
            category, provider = classify(target)
            parsed = urlparse(target)
            row = {
                "article_url": article["url"],
                "article_title": article.get("title", ""),
                "companies": meta.get("companies", ""),
                "documents": meta.get("documents", ""),
                "source_cells": meta.get("first_source", ""),
                "target_url": target,
                "target_host": parsed.hostname or "",
                "category": category,
                "provider_hint": provider,
                "article_state": article.get("state", ""),
            }
            rows.append(row)
            aggregate = by_link.setdefault(target, {**row, "article_urls": [], "companies_set": set(), "documents_set": set()})
            aggregate["article_urls"].append(article["url"])
            aggregate["companies_set"].update(x.strip() for x in meta.get("companies", "").split("|") if x.strip())
            aggregate["documents_set"].update(x.strip() for x in meta.get("documents", "").split("|") if x.strip())

    columns = ["article_url", "article_title", "companies", "documents", "source_cells", "target_url", "target_host", "category", "provider_hint", "article_state"]
    with (args.output_dir / "second-hop-occurrences.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader(); writer.writerows(rows)

    unique_rows = []
    candidates = defaultdict(lambda: {"entry_urls": set(), "article_urls": set(), "documents": set(), "providers": set()})
    for target, item in by_link.items():
        unique = {key: item[key] for key in columns if key in item}
        unique.update({"article_count": len(set(item["article_urls"])), "companies": " | ".join(sorted(item["companies_set"])), "documents": " | ".join(sorted(item["documents_set"]))})
        unique_rows.append(unique)
        if item["category"] in {"recognized_ats", "possible_recruitment"}:
            company_names = item["companies_set"] or {item.get("article_title") or item["target_host"]}
            for company in company_names:
                c = candidates[company]
                c["entry_urls"].add(target); c["article_urls"].update(item["article_urls"]); c["documents"].update(item["documents_set"])
                if item["provider_hint"]: c["providers"].add(item["provider_hint"])

    unique_columns = ["target_url", "target_host", "category", "provider_hint", "article_count", "companies", "documents", "article_url", "article_title", "source_cells", "article_state"]
    unique_rows.sort(key=lambda row: (row["category"], row["target_host"], row["target_url"]))
    with (args.output_dir / "second-hop-unique.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=unique_columns, extrasaction="ignore")
        writer.writeheader(); writer.writerows(unique_rows)

    candidate_rows = [{"display_name": company, "entry_urls": sorted(value["entry_urls"]), "source_article_urls": sorted(value["article_urls"]),
                       "documents": sorted(value["documents"]), "provider_hints": sorted(value["providers"]), "source_origin": "wps_wechat_second_hop"}
                      for company, value in sorted(candidates.items())]
    (args.output_dir / "api-candidates.json").write_text(json.dumps(candidate_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    category_counts = Counter(row["category"] for row in unique_rows)
    provider_counts = Counter(row["provider_hint"] for row in unique_rows if row["provider_hint"])
    summary = {"articles": sum(state_counts.values()), "article_state_counts": dict(state_counts), "external_url_occurrences": len(rows),
               "unique_external_urls": len(unique_rows), "category_counts": dict(category_counts), "provider_counts": dict(provider_counts),
               "candidate_company_labels": len(candidate_rows), "candidate_links": sum(len(x["entry_urls"]) for x in candidate_rows)}
    (args.output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
