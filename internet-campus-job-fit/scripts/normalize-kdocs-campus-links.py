#!/usr/bin/env python3
"""Build derived link indexes from raw kdocs-scrape checkpoints.

Raw cell chunks and hyperlink batches remain untouched.  This script only
creates review-friendly CSV/JSON files that retain source coordinates.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


TRACKING_KEYS = {"sessionid", "spread", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}
URL_RE = re.compile(r"https?://[^\s<>\"']+")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clean(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def company_key(value: str) -> str:
    value = re.sub(r"[\s·•・—–_()（）\[\]【】]+", "", clean(value)).lower()
    return value


def canonical_url(value: str) -> str:
    value = html.unescape(clean(value))
    if value.startswith("//"):
        value = "https:" + value
    try:
        parts = urlsplit(value)
    except ValueError:
        return value
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        return value
    host = parts.hostname.lower()
    port = f":{parts.port}" if parts.port and not (parts.scheme == "http" and parts.port == 80) and not (parts.scheme == "https" and parts.port == 443) else ""
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in TRACKING_KEYS], doseq=True)
    path = parts.path or "/"
    return urlunsplit((parts.scheme.lower(), host + port, path, query, parts.fragment))


def classify(url: str) -> tuple[str, str]:
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        text = (host + parts.path + "?" + parts.query).lower()
    except ValueError:
        return "invalid", ""
    if not host:
        return "invalid", ""
    if host.endswith("mokahr.com") or host.endswith("mokahr.io"):
        return "recognized_ats", "moka"
    if host.endswith("zhiye.com"):
        return "recognized_ats", "beisen"
    if host.endswith("jobs.feishu.cn") or host.endswith("jobs.f.mioffice.cn"):
        return "recognized_ats", "feishu"
    if host.endswith("hotjob.cn") or re.search(r"SU[\da-f]{24}", url, re.I):
        return "recognized_ats", "hotjob"
    if host in {"mp.weixin.qq.com", "weixin.qq.com"}:
        return "article", "wechat"
    if any(domain in host for domain in ["nowcoder.com", "zhaopin.com", "51job.com", "liepin.com", "bosszhipin.com", "iguopin.com", "duomian.com"]):
        return "aggregator_or_assessment", ""
    if re.search(r"job|career|recruit|campus|school|zhaopin|hr|talent|join", text):
        return "possible_recruitment", "unknown"
    return "other", ""


def load_rows(sheet_dir: Path) -> list[list]:
    rows: list[list] = []
    for chunk in sorted((sheet_dir / "chunks").glob("chunk_*.json")):
        value = read_json(chunk)
        if not isinstance(value, list):
            raise RuntimeError(f"Invalid value chunk {chunk}: expected list, got {type(value).__name__}")
        rows.extend(value)
    return rows


def find_header(rows: list[list]) -> tuple[int, dict[str, int]]:
    for row_index, row in enumerate(rows[:20], start=1):
        labels = {clean(value): index + 1 for index, value in enumerate(row)}
        if any("公司名称" in label for label in labels):
            return row_index, labels
    return 0, {}


def value_for(row: list, headers: dict[str, int], names: tuple[str, ...]) -> str:
    for label, column in headers.items():
        if any(name in label for name in names):
            return clean(row[column - 1] if column <= len(row) else "")
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sources", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    known: dict[str, str] = {}
    known_hosts: set[str] = set()
    if args.sources and args.sources.exists():
        for company in read_json(args.sources).get("companies", []):
            for name in [company.get("display_name", ""), *(company.get("aliases") or [])]:
                if company_key(name):
                    known[company_key(name)] = company.get("company_id", "")
            for source_url in [company.get("primary_entry_url", ""), *[request.get("url", "") for request in company.get("validated_api_request_examples", [])]]:
                try:
                    host = (urlsplit(source_url).hostname or "").lower()
                    if host: known_hosts.add(host)
                except ValueError:
                    pass

    occurrences = []
    for meta_path in sorted(args.raw.rglob("_meta.json")):
        meta = read_json(meta_path)
        sheet_dir = meta_path.parent
        rows = load_rows(sheet_dir)
        if len(rows) != meta["rows"]:
            raise RuntimeError(f"Row count mismatch: {sheet_dir}: {len(rows)} != {meta['rows']}")
        header_row, headers = find_header(rows)
        header_values = rows[header_row - 1] if header_row else []
        hyperlink_cells: set[tuple[int, int, str]] = set()
        for batch in sorted((sheet_dir / "hyperlinks").glob("batch_*.json")):
            for link in read_json(batch):
                row_number = link.get("row")
                col_number = link.get("col")
                row = rows[row_number - 1] if isinstance(row_number, int) and 0 < row_number <= len(rows) else []
                url = clean(link.get("address"))
                normalized = canonical_url(url)
                hyperlink_cells.add((row_number, col_number, normalized))
                category, provider = classify(normalized)
                company = value_for(row, headers, ("公司名称",))
                occurrences.append({
                    "document_tag": meta["document_tag"], "document_title": meta["document_title"],
                    "document_url": meta["url"], "sheet_name": meta["sheet_name"],
                    "row": row_number or "", "column": col_number or "", "link_index": link.get("idx", ""), "source_kind": "wps_hyperlink",
                    "column_label": clean(header_values[col_number - 1]) if isinstance(col_number, int) and col_number <= len(header_values) else "",
                    "display_text": clean(link.get("text")), "cell_text": clean(row[col_number - 1]) if isinstance(col_number, int) and col_number <= len(row) else "",
                    "url_original": url, "url_normalized": normalized, "link_category": category, "provider_hint": provider,
                    "company_name": company, "known_company_id": known.get(company_key(company), ""),
                    "industry": value_for(row, headers, ("行业细分", "行业大类", "行业")),
                    "ownership": value_for(row, headers, ("企业性质", "性质")),
                    "recruitment_type": value_for(row, headers, ("招聘性质",)),
                    "recruitment_target": value_for(row, headers, ("招聘对象",)),
                    "status": value_for(row, headers, ("招聘状态",)),
                    "city": value_for(row, headers, ("招聘地点", "工作地点", "地点")),
                    "jobs": value_for(row, headers, ("招聘岗位", "岗位")),
                })
        for row_number, row in enumerate(rows, start=1):
            for col_number, value in enumerate(row, start=1):
                for text_index, url in enumerate(URL_RE.findall(clean(value)), start=1):
                    url = url.rstrip("),.，。；;")
                    normalized = canonical_url(url)
                    if (row_number, col_number, normalized) in hyperlink_cells:
                        continue
                    category, provider = classify(normalized)
                    company = value_for(row, headers, ("公司名称",))
                    occurrences.append({
                        "document_tag": meta["document_tag"], "document_title": meta["document_title"],
                        "document_url": meta["url"], "sheet_name": meta["sheet_name"],
                        "row": row_number, "column": col_number, "link_index": text_index, "source_kind": "plain_text_url",
                        "column_label": clean(header_values[col_number - 1]) if col_number <= len(header_values) else "",
                        "display_text": url, "cell_text": clean(value),
                        "url_original": url, "url_normalized": normalized, "link_category": category, "provider_hint": provider,
                        "company_name": company, "known_company_id": known.get(company_key(company), ""),
                        "industry": value_for(row, headers, ("行业细分", "行业大类", "行业")),
                        "ownership": value_for(row, headers, ("企业性质", "性质")),
                        "recruitment_type": value_for(row, headers, ("招聘性质",)),
                        "recruitment_target": value_for(row, headers, ("招聘对象",)),
                        "status": value_for(row, headers, ("招聘状态",)),
                        "city": value_for(row, headers, ("招聘地点", "工作地点", "地点")),
                        "jobs": value_for(row, headers, ("招聘岗位", "岗位")),
                    })

    occurrence_fields = list(occurrences[0]) if occurrences else []
    with (args.output / "all-link-occurrences.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=occurrence_fields)
        writer.writeheader(); writer.writerows(occurrences)

    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in occurrences:
        grouped[row["url_normalized"] or row["url_original"]].append(row)
    unique_rows = []
    for url, rows in grouped.items():
        first = rows[0]
        unique_rows.append({
            "url_normalized": url, "url_original_first": first["url_original"],
            "host": (urlsplit(url).hostname or "") if url else "",
            "link_category": first["link_category"], "provider_hint": first["provider_hint"],
            "occurrence_count": len(rows),
            "companies": " | ".join(dict.fromkeys(r["company_name"] for r in rows if r["company_name"])),
            "documents": " | ".join(dict.fromkeys(r["document_tag"] for r in rows)),
            "column_labels": " | ".join(dict.fromkeys(r["column_label"] for r in rows if r["column_label"])),
            "known_company_ids": " | ".join(dict.fromkeys(r["known_company_id"] for r in rows if r["known_company_id"])),
            "first_source": f"{first['document_tag']}:{first['sheet_name']}:R{first['row']}C{first['column']}",
        })
    unique_rows.sort(key=lambda row: (row["link_category"], row["host"], row["url_normalized"]))
    with (args.output / "unique-links.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(unique_rows[0]) if unique_rows else [])
        if unique_rows: writer.writeheader(); writer.writerows(unique_rows)

    domain_counts = Counter((urlsplit(row["url_normalized"]).hostname or "") for row in occurrences if row["url_normalized"])
    domain_rows = [{"host": host, "occurrences": count, "unique_links": sum(1 for row in unique_rows if row["host"] == host)} for host, count in domain_counts.most_common()]
    with (args.output / "domain-summary.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["host", "occurrences", "unique_links"])
        writer.writeheader(); writer.writerows(domain_rows)

    company_links: dict[str, dict] = {}
    for row in occurrences:
        key = company_key(row["company_name"])
        if not key:
            continue
        item = company_links.setdefault(key, {"display_name": row["company_name"], "known_company_id": row["known_company_id"], "industry": row["industry"], "urls": {}})
        if not item["industry"] and row["industry"]:
            item["industry"] = row["industry"]
        if row["url_normalized"]:
            item["urls"][row["url_normalized"]] = {"url": row["url_normalized"], "category": row["link_category"], "provider_hint": row["provider_hint"]}

    candidates = []
    for item in company_links.values():
        recognized = [u["url"] for u in item["urls"].values() if u["category"] == "recognized_ats"]
        if recognized:
            candidates.append({
                "display_name": item["display_name"], "category": item["industry"] or "待确认细分行业",
                "known_company_id": item["known_company_id"], "entry_urls": recognized,
                "discovery_source": "wps-campus-spreadsheets-2025-2027",
            })
    candidates.sort(key=lambda item: (bool(item["known_company_id"]), item["display_name"]))
    write_json(args.output / "recognized-ats-candidates.json", candidates)
    ignored_hosts = {"www.mohrss.gov.cn", "www.job.mohrss.gov.cn", "young.yingjiesheng.com", "campus.yingjiesheng.com", "2025.yingjiesheng.com", "2026.yingjiesheng.com", "www.zhipin.com", "campus.chinahr.com", "mp.weixinbridge.com"}
    page_candidates = []
    for item in company_links.values():
        urls = []
        for record in item["urls"].values():
            if record["category"] != "possible_recruitment":
                continue
            try:
                host = (urlsplit(record["url"]).hostname or "").lower()
            except ValueError:
                continue
            if host and host not in known_hosts and host not in ignored_hosts:
                urls.append(record["url"])
        if urls:
            page_candidates.append({"display_name": item["display_name"], "category": item["industry"] or "待确认细分行业", "entry_urls": list(dict.fromkeys(urls)), "discovery_source": "wps-campus-spreadsheets-2025-2027-possible-recruitment-page"})
    page_candidates.sort(key=lambda item: item["display_name"])
    write_json(args.output / "possible-recruitment-page-candidates.json", page_candidates)
    plain_text_candidates = []
    for row in occurrences:
        if row["source_kind"] != "plain_text_url" or row["link_category"] not in {"recognized_ats", "possible_recruitment"}:
            continue
        plain_text_candidates.append({
            "display_name": row["company_name"] or f"未命名-R{row['row']}C{row['column']}",
            "category": row["industry"] or "待确认细分行业",
            "entry_urls": [row["url_normalized"]],
            "discovery_source": "wps-campus-spreadsheets-2025-2027-plain-text-url",
        })
    write_json(args.output / "plain-text-url-candidates.json", plain_text_candidates)
    write_json(args.output / "summary.json", {
        "documents": len({row["document_tag"] for row in occurrences}),
        "hyperlink_occurrences": len(occurrences), "link_occurrences": len(occurrences),
        "wps_hyperlink_occurrences": sum(row["source_kind"] == "wps_hyperlink" for row in occurrences),
        "plain_text_url_occurrences": sum(row["source_kind"] == "plain_text_url" for row in occurrences),
        "unique_links": len(unique_rows),
        "companies_with_links": len(company_links), "recognized_ats_companies": len(candidates),
        "recognized_ats_new_company_candidates": sum(not item["known_company_id"] for item in candidates),
        "possible_recruitment_page_candidates": len(page_candidates),
        "category_counts": dict(Counter(row["link_category"] for row in occurrences)),
        "provider_counts": dict(Counter(row["provider_hint"] for row in occurrences if row["provider_hint"])),
    })
    print(json.dumps(read_json(args.output / "summary.json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
