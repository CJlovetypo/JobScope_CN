#!/usr/bin/env python3
"""Prepare non-core-ATS candidates from every WPS link for deep API review."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def names(company: dict) -> list[str]:
    return [company.get("display_name", ""), *(company.get("aliases") or [])]


def name_key(value: str) -> str:
    return re.sub(r"[\s·•・—–_()（）\[\]【】|丨／/\-]+", "", value or "").lower()


def provider_tenant(source: dict) -> tuple[str, str] | None:
    provider = source.get("provider", "")
    config = source.get("api_config") or {}
    tenant = {
        "51job_coapi": config.get("ctmid"),
        "51job_xyz": config.get("ehire_ctm_id"),
        "zhaopin_grace": config.get("org_number"),
        "greenhouse": config.get("board_token"),
        "nowcoder_public": config.get("company_id"),
        "smartrecruiters": config.get("company_identifier"),
        "oracle_recruiting": "|".join([config.get("origin", ""), config.get("site", "")]),
        "workday": "|".join([config.get("origin", ""), config.get("tenant", ""), config.get("site", "")]),
    }.get(provider)
    return (provider, str(tenant)) if tenant else None


def classify(url: str) -> tuple[str, dict]:
    try:
        parsed = urlparse(url)
    except ValueError:
        return "", {}
    host, path = parsed.hostname or "", parsed.path
    query = {key.lower(): value for key, value in parse_qs(parsed.query).items()}
    lower = (host + path).lower()
    if host.endswith("51job.com"):
        tenant = next(iter(query.get("ctmid", []) or query.get("ehirectmid", [])), "")
        provider = "51job_xyz" if host.startswith(("xyz.", "xyzp.")) or "/consumer/" in path else "51job_coapi"
        return provider, {"tenant": tenant}
    if host.endswith("zhaopin.com") or host.endswith("ywzhaopin.com") or host.endswith("vhzhaopin.com") or host.endswith("ciiczhaopin.com"):
        tenant = next(iter(query.get("orgnumber", []) or query.get("org", [])), "")
        return "zhaopin_grace", {"tenant": tenant}
    workday = re.match(r"^([^.]+)\.wd\d+\.myworkdayjobs\.com$", host, re.I)
    if workday:
        segments = [part for part in path.split("/") if part]
        if segments and re.fullmatch(r"[a-z]{2}-[A-Z]{2}", segments[0]):
            segments.pop(0)
        site = segments[0] if segments and segments[0] != "job" else ""
        return "workday", {"tenant": workday.group(1), "site": site, "origin": f"{parsed.scheme}://{host}"}
    if host == "jobs.smartrecruiters.com":
        company = next(iter([part for part in path.split("/") if part]), "")
        return "smartrecruiters", {"tenant": company}
    if host in {"job-boards.greenhouse.io", "boards.greenhouse.io"}:
        parts = [part for part in path.split("/") if part]
        tenant = parts[0] if parts and parts[0] not in {"embed", "jobs"} else next(iter(query.get("for", [])), "")
        return "greenhouse", {"tenant": tenant}
    if host.endswith("oraclecloud.com") and "/sites/" in path:
        site = path.split("/sites/", 1)[1].split("/", 1)[0]
        return "oracle_recruiting", {"tenant": f"{parsed.scheme}://{host}|{site}", "site": site, "origin": f"{parsed.scheme}://{host}"}
    if "nowcoder.com" in host:
        company_id = next(iter(query.get("companyid", [])), "")
        enterprise = re.search(r"/enterprise/(\d+)", path)
        if enterprise:
            company_id = enterprise.group(1)
        return "nowcoder_public", {"tenant": company_id}
    if host in {"jobs.lever.co", "api.lever.co"}:
        tenant = next(iter([part for part in path.split("/") if part]), "")
        return "lever", {"tenant": tenant}
    if "taleo.net" in host:
        return "taleo", {"tenant": host.split(".")[0]}
    if re.search(r"job|career|recruit|campus|school|zhaopin|talent|join|hr", lower):
        return "custom_page", {"tenant": host}
    return "", {}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("links", type=Path)
    parser.add_argument("registry", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    registry = read_json(args.registry)
    known_names = {name_key(alias): company for company in registry["companies"] for alias in names(company) if alias}
    configured = {item for company in registry["companies"] for source in (company.get("recruitment_sources") or [company]) if (item := provider_tenant(source))}
    candidates: dict[tuple, dict] = {}
    with args.links.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            provider, detail = classify(row["url_normalized"])
            if not provider or provider in {"custom_page", "taleo"} and row["link_category"] in {"article", "aggregator_or_assessment"}:
                continue
            company = known_names.get(name_key(row["company_name"]))
            tenant = str(detail.get("tenant") or "")
            state = "ready" if tenant and provider not in {"taleo", "custom_page"} else "needs_discovery"
            if tenant and (provider, tenant) in configured:
                state = "already_configured"
            key = (row["company_name"], provider, tenant or row["url_normalized"])
            item = candidates.setdefault(key, {
                "display_name": row["company_name"], "company_id": company.get("company_id") if company else "",
                "category": row["industry"] or "待确认细分行业", "provider_hint": provider,
                "tenant_hint": tenant, "state": state, "entry_urls": [], "documents": [], "discovery": detail,
            })
            if row["url_normalized"] not in item["entry_urls"]:
                item["entry_urls"].append(row["url_normalized"])
            if row["document_tag"] not in item["documents"]:
                item["documents"].append(row["document_tag"])
    output = sorted(candidates.values(), key=lambda item: (item["state"], item["provider_hint"], item["display_name"]))
    write_json(args.output, output)
    print(json.dumps({
        "candidates": len(output),
        "states": dict(Counter(item["state"] for item in output)),
        "providers": dict(Counter(item["provider_hint"] for item in output)),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
