#!/usr/bin/env python3
"""Resolve the 357 self-hosted API clues into host-level contract conclusions."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


CONTRACTS = {
    "campus.10jqka.com.cn": ("recovered_full_jd", "GET apply_list；page/pageCount 分页；列表内含职责、要求、地点与校招批次。", "10jqka_campus"),
    "campus.cec.com.cn": ("recovered_full_jd", "真实 API 前缀为 /student-api；POST position/search，page/size 分页，positionType=0 为校招。", "cec_campus"),
    "career.cec.com.cn": ("alias_contract_recovered", "前端路径与 campus.cec.com.cn 同源实现；采用已验证的 /student-api 合同。", "cec_campus"),
    "hr.tp-link.com.cn": ("recovered_full_jd", "POST /api/v1/job/get；page/limit 分页；Duty 与 Requirement 在列表内完整返回。", "tplink_domestic"),
    "hr.wenhua.com.cn": ("recovered_full_jd", "POST /api/dataapi/job?whid=wenhua；单次返回完整岗位数组。", "wenhua_public"),
    "campus.jd.com": ("already_configured", "现有 jd 采集器已使用 /api/wx/position/page 与逐岗位 detail。", "jd"),
    "storage.360buyimg.com": ("wrong_static_base", "接口字符串来自静态资源域；实际 JD API 在 campus.jd.com。", "jd"),
    "storage.jd.com": ("wrong_static_base", "接口字符串来自静态资源域；实际 JD API 在 campus.jd.com。", "jd"),
    "img2.ch999img.com": ("stale_or_wrong_static_base", "jobAPI.aspx 线索在图片域直接请求为 404，尚未恢复真实 API 基址。", ""),
    "static.tcy365.com": ("wrong_static_base", "接口字符串来自静态资源域，按该域请求为 404；真实 API 基址仍待定位。", ""),
    "portal-portm.meituan.com": ("not_job_api", "该接口是城市 CDN 配置，不是岗位列表或 JD 详情；美团岗位已有独立采集器。", "meituan"),
    "careers.citics.com": ("contract_partial_missing_parameter", "已恢复真实基址 global-kong.citics.com、sysNo=CSE001 与 POST form 合同；招聘信息类型字段/值仍待还原。", ""),
    "job.cscec8b.com.cn": ("detail_only_no_enumeration", "9 条 share/jid 接口可定位固定岗位详情，但尚未找到可完整枚举当前校招的列表合同。", ""),
    "hr.cnzgc.com": ("non_list_clues_only", "现有线索均为投递、测评、阶段状态或树配置接口，未发现完整 JD 列表合同。", ""),
    "job.ihnhr.com": ("contract_partial", "已定位 jobs/v3/list 与 info，但请求参数、主体边界和完整分页仍未完成验证。", ""),
    "www.ihnhr.com": ("contract_partial", "已定位 jobs/v1/list 与活动接口，仍需验证请求参数和 JD 正文完整性。", ""),
    "www.sydwgkzp.cn": ("contract_partial", "已定位 GetPostSelectFyList，仍需还原 POST 参数及分页。", ""),
    "hr.163.com": ("contract_partial", "只定位到 position API 根路径，缺少当前列表参数和完整分页合同。", ""),
    "zhr.crec.cn": ("contract_partial", "只定位到 hr-basic-recruit 服务前缀，尚未恢复岗位列表路由。", ""),
    "job.pumc.edu.cn": ("service_prefix_only", "线索为 fileservice/hr 服务前缀，未包含岗位列表与详情合同。", ""),
    "wx.bda.com": ("web_detail_not_api", "现有链接是 PHP 岗位页，不是可枚举的匿名 JSON API。", ""),
    "www.upm.com": ("content_api_not_job_list", "CDA 接口返回官网内容块，不是可分页岗位 API。", ""),
    "gkzp.mochr.com": ("notice_api_not_jd_list", "接口用于招聘公告，未证明可取得逐岗位完整 JD。", ""),
    "www.caep-scns.ac.cn": ("web_page_not_api", "job_list.php 是网页列表，未发现结构化岗位 API。", ""),
    "joinus.hkcqjy.com.cn": ("write_endpoint_not_source", "线索是 updateRecommend 写接口，不能用作只读岗位来源。", ""),
    "www.hnrcsc.com": ("activity_api_not_jd_list", "接口返回招聘活动，未证明可枚举完整 JD。", ""),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clues", type=Path)
    parser.add_argument("hcm_manifest", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args(); args.output_dir.mkdir(parents=True, exist_ok=True)
    hcm = json.loads(args.hcm_manifest.read_text(encoding="utf-8-sig"))
    for item in hcm:
        urls = item.get("entry_urls") or [attempt.get("entry_url") for attempt in item.get("attempts", []) if attempt.get("entry_url")]
        if not urls: continue
        from urllib.parse import urlparse
        host = urlparse(urls[0]).hostname
        if not host: continue
        if item.get("state") == "verified_api_full_jd":
            CONTRACTS[host] = ("recovered_full_jd", f"HCMCloud 公共协议已验证；{item.get('complete_jds', 0)} 条完整 JD。", "hcmcloud_public")
        elif item.get("state") == "empty_or_incomplete_api":
            CONTRACTS[host] = ("api_accessible_empty_or_incomplete", f"HCMCloud 协议可访问；当前完整 JD 为 {item.get('complete_jds', 0)}，不准入评估。", "hcmcloud_public")
        elif "key material unavailable" in (item.get("reason") or ""):
            CONTRACTS[host] = ("hcm_key_material_unavailable", item.get("reason"), "hcmcloud_public")
        else:
            CONTRACTS.setdefault(host, ("hcm_other_failure", item.get("reason") or "HCMCloud 验证失败", "hcmcloud_public"))

    with args.clues.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if row["结论"] == "已发现接口线索，待确认请求参数、主体与分页"]
    reviewed = []
    by_host = defaultdict(list)
    for row in rows:
        status, conclusion, provider = CONTRACTS.get(row["主机"], ("still_pending", "本轮尚未恢复可证明完整 JD、主体和分页的只读合同。", ""))
        item = {**row, "复核状态": status, "复核结论": conclusion, "可用provider": provider}
        reviewed.append(item); by_host[row["主机"]].append(item)
    columns = list(reviewed[0])
    with (args.output_dir / "接口线索逐条复核-v2.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns); writer.writeheader(); writer.writerows(reviewed)
    host_rows=[]
    for host, items in sorted(by_host.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        first=items[0];host_rows.append({"主机":host,"线索条数":len(items),"公司标签数":len({x['公司标签'] for x in items}),"复核状态":first['复核状态'],"复核结论":first['复核结论'],"可用provider":first['可用provider']})
    with (args.output_dir / "接口主机复核-v2.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer=csv.DictWriter(handle,fieldnames=list(host_rows[0]));writer.writeheader();writer.writerows(host_rows)
    clue_counts=Counter(item["复核状态"] for item in reviewed);host_counts=Counter(item["复核状态"] for item in host_rows)
    recovered={"recovered_full_jd","alias_contract_recovered","already_configured"}
    summary={"clues_reviewed":len(reviewed),"hosts_reviewed":len(host_rows),"clue_status_counts":dict(clue_counts),"host_status_counts":dict(host_counts),
             "resolved_usable_clues":sum(v for k,v in clue_counts.items() if k in recovered),"resolved_usable_hosts":sum(v for k,v in host_counts.items() if k in recovered),
             "remaining_pending_clues":sum(v for k,v in clue_counts.items() if k in {"contract_partial","contract_partial_missing_parameter","still_pending"})}
    (args.output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2)+"\n",encoding="utf-8")
    lines=["# 357 条接口线索二次深挖", "", f"本轮逐条复核 **{len(reviewed)}** 条线索，归并为 **{len(host_rows)}** 个主机合同。", "", "## 结果", "", "| 状态 | 线索 | 主机 |", "|---|---:|---:|"]
    for status,count in clue_counts.most_common(): lines.append(f"| `{status}` | {count} | {host_counts.get(status,0)} |")
    lines += ["", "“可访问”仍不自动等于“准入”：只有能匿名直连、完整分页、取得完整 JD 且主体可核对的来源才进入 Skill。", "", "## 主机结论", "", "| 主机 | 线索 | 状态 | 结论 |", "|---|---:|---|---|"]
    for row in host_rows: lines.append(f"| {row['主机']} | {row['线索条数']} | `{row['复核状态']}` | {row['复核结论']} |")
    (args.output_dir / "接口线索深挖报告.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__": main()
