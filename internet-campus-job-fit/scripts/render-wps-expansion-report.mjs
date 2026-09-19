import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {SKILL_ROOT} from './lib/io.mjs';

const artifactRoot=path.join(SKILL_ROOT,'artifacts','wps-campus-sources-20260919');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const csvCell=value=>`"${String(value??'').replaceAll('"','""')}"`;
const writeCsv=async(file,headers,rows)=>fs.writeFile(file,'\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
const registry=await read(datasetPath(SKILL_ROOT,'assets/sources.json'));
const before=await read(path.join(artifactRoot,'before-integration','sources.json'));
const proof=await read(path.join(SKILL_ROOT,'data','source-verification-wps-20260919.json'));
const recognized=await read(path.join(artifactRoot,'api-verification','manifest-v2.json'));
const pages=await read(path.join(artifactRoot,'page-api-verification','manifest.json'));
const retry=await read(path.join(artifactRoot,'page-api-retry','manifest.json'));
const plainText=await read(path.join(artifactRoot,'plain-text-api-verification','manifest.json'));
const documents=await read(path.join(artifactRoot,'documents.json'));
const derived=await read(path.join(artifactRoot,'derived','summary.json'));
const cityIndex=await read(path.join(SKILL_ROOT,'data','company-city-index.json'));

const currentById=new Map(registry.companies.map(company=>[company.company_id,company]));
const beforeIds=new Set(before.companies.map(company=>company.company_id));
const cities=new Map(cityIndex.companies.map(company=>[company.company_id,company.cities||[]]));
const newCompanies=registry.companies.filter(company=>!beforeIds.has(company.company_id)).sort((a,b)=>a.display_name.localeCompare(b.display_name,'zh-CN'));
const proofCompanyIds=new Set(proof.configurations.map(item=>item.company_id));
const enrichedCompanies=[...proofCompanyIds].filter(id=>beforeIds.has(id));
const providerCounts=Object.fromEntries(Object.entries(proof.configurations.reduce((out,item)=>(out[item.provider]=(out[item.provider]||0)+1,out),{})).sort((a,b)=>b[1]-a[1]));
const formalSources=proof.configurations.filter(item=>item.formal_open_full_jds_observed>0);
const sourceMap=new Map();
for(const company of registry.companies)for(const source of [company,...(company.recruitment_sources||[])])sourceMap.set(`${company.company_id}:${source.source_id||''}`,source);

await writeCsv(path.join(artifactRoot,'新增公司.csv'),['公司','行业标签','城市标签','API 来源数','招聘入口'],newCompanies.map(company=>{
  const configurations=proof.configurations.filter(item=>item.company_id===company.company_id);
  return [company.display_name,(company.industry_tags||[]).join('、'),(cities.get(company.company_id)||[]).join('、'),configurations.length,configurations.map(item=>item.entry_url).join('\n')];
}));
await writeCsv(path.join(artifactRoot,'已准入API来源.csv'),['公司','来源ID','ATS/API 类型','招聘入口','完整JD样本数','当前正式校招完整JD数','完整JD示例链接','核验时间'],proof.configurations.sort((a,b)=>a.display_name.localeCompare(b.display_name,'zh-CN')).map(item=>[
  item.display_name,item.source_id,item.provider,item.entry_url,item.complete_jds_observed,item.formal_open_full_jds_observed,item.samples.map(sample=>sample.official_url).join('\n'),item.checked_at,
]));

const retryByName=new Map(retry.map(item=>[item.display_name,item]));
const rejected=[...recognized,...pages,...plainText].filter(item=>!item.admitted).map(item=>{
  const retried=retryByName.get(item.display_name);
  return {...item,retry_state:retried?.state||'',retry_reason:retried?.reason||''};
});
await writeCsv(path.join(artifactRoot,'API核验未准入.csv'),['公司','候选类型','候选入口','状态','原因','复跑状态','复跑原因'],rejected.map(item=>[
  item.display_name,item.ats_context?'已识别ATS':'自有域名招聘页',(item.entry_urls||[item.entry_url]).join('\n'),item.state,item.reason,item.retry_state,item.retry_reason,
]));

const metas=[];
for(const doc of documents){
  const docDir=path.join(artifactRoot,'raw',doc.tag);
  for(const child of await fs.readdir(docDir,{withFileTypes:true}))if(child.isDirectory())metas.push(await read(path.join(docDir,child.name,'_meta.json')));
}
const totalRows=metas.reduce((sum,item)=>sum+item.rows,0);
const stateCounts=items=>items.reduce((out,item)=>(out[item.state]=(out[item.state]||0)+1,out),{});
const recognizedStates=stateCounts(recognized), pageStates=stateCounts(pages), retryStates=stateCounts(retry);
const plainTextStates=stateCounts(plainText);
const industryCounts=Object.fromEntries(Object.entries(registry.industry_counts||{}).sort((a,b)=>b[1]-a[1]));
const summary={
  generated_at:new Date().toISOString(),documents:documents.length,raw_rows:totalRows,link_occurrences:derived.link_occurrences,wps_hyperlink_occurrences:derived.wps_hyperlink_occurrences,plain_text_url_occurrences:derived.plain_text_url_occurrences,unique_links:derived.unique_links,companies_with_links:derived.companies_with_links,
  companies_before:before.companies.length,companies_after:registry.companies.length,new_companies:newCompanies.length,enriched_existing_companies:enrichedCompanies.length,
  admitted_api_sources:proof.configurations.length,sources_with_current_formal_open_full_jd:formalSources.length,provider_counts:providerCounts,
  recognized_ats_review:{candidates:recognized.length,states:recognizedStates},custom_page_review:{candidates:pages.length,states:pageStates},network_retry:{candidates:retry.length,states:retryStates},plain_text_url_api_review:{candidates:plainText.length,states:plainTextStates},industry_counts:industryCounts,
};
await fs.writeFile(path.join(artifactRoot,'final-summary.json'),JSON.stringify(summary,null,2)+'\n');

const rows=documents.map(doc=>{
  const meta=metas.find(item=>item.document_tag===doc.tag);
  return `| ${doc.title} | ${meta?.rows||0} | ${meta?.hyperlinks_count||0} | [原文](${doc.url}) |`;
}).join('\n');
const report=`# WPS 校招来源扩容报告（2026-09-19）

## 结果

- 已完整归档浏览器中打开的 **${documents.length} 份** WPS 校招表，共 **${totalRows.toLocaleString('zh-CN')} 行**。
- 抽取 **${derived.link_occurrences.toLocaleString('zh-CN')} 条链接记录**，其中 WPS 超链接对象 ${derived.wps_hyperlink_occurrences.toLocaleString('zh-CN')} 条、单元格纯文本 URL ${derived.plain_text_url_occurrences.toLocaleString('zh-CN')} 条；去重后 **${derived.unique_links.toLocaleString('zh-CN')} 条链接**。文档中的链接全部保留，不因是否适合当前 Skill 而删除。
- 只有经匿名 API 实测可以取得完整岗位职责和任职要求的来源才写入 Skill：共 **${proof.configurations.length} 个 API 来源配置**，覆盖 **${proofCompanyIds.size} 家公司**。
- 来源库由 **${before.companies.length.toLocaleString('zh-CN')} 家**增至 **${registry.companies.length.toLocaleString('zh-CN')} 家**：新增 **${newCompanies.length} 家**，另有 **${enrichedCompanies.length} 家**既有公司获得新入口。
- 当前能直接取得明确正式校招完整 JD 的来源有 **${formalSources.length} 个**。其余已准入来源证明了完整 JD API 能力，但当前可能只有实习、岗位为空或招聘性质待核实；运行 Skill 时仍只评估明确正式校招。

## 原始文档

| 文档 | 数据行 | WPS 超链接对象 | WPS 地址 |
|---|---:|---:|---|
${rows}

原始值、原始超链接响应、合并 CSV 和每份表的元数据均保存在 [raw](./raw/)；全量链接见 [all-link-occurrences.csv](./derived/all-link-occurrences.csv)，去重链接见 [unique-links.csv](./derived/unique-links.csv)。

## API 核验

第一层针对已识别的北森、Moka、飞书招聘、华招 Hotjob 租户进行列表和详情 API 实测：${recognized.length} 个候选中，${recognizedStates.verified_api_full_jd||0} 个可取得完整 JD，${recognizedStates.empty_or_incomplete_api||0} 个接口为空或正文不完整，${recognizedStates.unverified||0} 个未确认。

第二层针对 ${pages.length} 个自有域名招聘页反查公开 ATS/API：${pageStates.verified_api_full_jd||0} 个可取得完整 JD，${pageStates.empty_or_incomplete_api||0} 个为空或不完整，${pageStates.unverified||0} 个未确认。对其中 ${retry.length} 个网络失败或超时入口使用更长超时复跑，结果仍为 ${retryStates.unverified||0} 个未确认，没有新增准入来源。

纯文本 URL 审计额外发现 ${derived.plain_text_url_occurrences} 条未被 WPS 标成超链接对象的 URL；排除来源库已有租户后，对 ${plainText.length} 个新增 ATS 租户补跑 API 核验，${plainTextStates.verified_api_full_jd||0} 个可取得完整 JD，${plainTextStates.unverified||0} 个未确认。可用入口归并到春秋航空、云康集团和西部证券，其中与既有配置重复的入口按招聘主体去重。

准入来源按平台统计：${Object.entries(providerCounts).map(([name,count])=>`${name} ${count}`).join('、')}。每个准入配置均保存成功 API 请求、响应 SHA-256、响应文件和完整 JD 示例，见 [source-verification-wps-20260919.json](../../data/source-verification-wps-20260919.json)。

## 可审阅清单

- [已准入API来源.csv](./已准入API来源.csv)：${proof.configurations.length} 个可用配置、岗位示例和核验时间。
- [新增公司.csv](./新增公司.csv)：${newCompanies.length} 家新招聘主体及行业、城市标签。
- [API核验未准入.csv](./API核验未准入.csv)：所有本轮未准入候选及原因，包含超时复跑结论。
- [domain-summary.csv](./derived/domain-summary.csv)：全量链接域名分布。

“未确认”表示本轮没有找到满足标准的匿名完整 JD API，不能解释为公司没有招聘或永久无法抓取。部分入口可能已经过期、需要登录、受访问限制，或使用尚未适配的自研接口，后续可基于证据继续定向反查。
`;
await fs.writeFile(path.join(artifactRoot,'扩容报告.md'),report);
console.log(JSON.stringify(summary,null,2));
