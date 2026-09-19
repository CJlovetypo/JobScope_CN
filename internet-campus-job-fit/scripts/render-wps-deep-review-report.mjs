import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT=path.resolve(process.argv[2]||path.join(import.meta.dirname,'..'));
const REVIEW=path.resolve(process.argv[3]||path.join(ROOT,'artifacts/wps-campus-sources-20260919/deep-api-review'));
const read=file=>fs.readFile(file,'utf8').then(JSON.parse);
const csvCell=value=>'"'+String(value??'').replaceAll('"','""').replaceAll('\r',' ').replaceAll('\n',' ')+'"';
const csv=(headers,rows)=>'\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
const summary=await read(path.join(REVIEW,'deep-integration-summary.json'));
const registry=await read(datasetPath(ROOT,'assets/sources.json'));
const staticRows=await read(path.join(REVIEW,'custom-static-discovery-v1/manifest.json'));
const common=await read(path.join(REVIEW,'common-ats-recovery-verification/manifest.json'));
const ready=await read(path.join(REVIEW,'ready-verification-v2/manifest.json'));
const discovered=await read(path.join(REVIEW,'discovered-tenant-verification/manifest.json'));
const zhaopin=await read(path.join(REVIEW,'zhaopin-verification-v3/manifest.json'));
const hcm=await read(path.join(REVIEW,'hcmcloud-verification-v2/manifest.json'));
const shlab=await read(path.join(REVIEW,'self-built/shlab-verification/result.json'));
const count=(rows,predicate)=>rows.filter(predicate).length;
const totals={static:staticRows.length,read:count(staticRows,x=>x.state==='page_read_no_tenant'),unreachable:count(staticRows,x=>x.state==='unreachable'),apiHints:count(staticRows,x=>x.hints?.apiPaths?.length),platformHints:count(staticRows,x=>x.hints?.absolutePlatforms?.length)};
let sourceCount=0;for(const company of registry.companies)sourceCount+=company.recruitment_sources?.length||1;

const commonHosts=/mokahr\.com|zhiye\.com|hotjob\.cn|jobs\.(?:feishu\.cn|f\.mioffice\.cn)|51job\.com|zhaopin\.com|myworkdayjobs\.com|hcmcloud/i;
const asset=/\.(?:js|css|png|jpe?g|svg|gif|webp|woff2?|map)(?:\?|$)/i;
const apiLike=value=>/\/api(?:\/|\?|$)|https?:\/\/api[.-]|(?:job|position|recruit|career)[^/]*\.(?:php|ashx)(?:\?|$)|jobapi/i.test(value)&&!asset.test(value)&&!/sentry|analytics|captcha|upload|login|sendcode|facebook\.com\/sharer/i.test(value);
const known=new Map([
  ['www.shlab.org.cn','已准入；校招频道当前仅实习'],['zh-cn.ubisoft.com','已在来源库；公开列表含完整 JD'],['jobs.bilibili.com','已在来源库'],['s1.hdslb.com','已在来源库'],['www.amazon.jobs','已在来源库'],
]);
const leads=[];
for(const row of staticRows)for(const endpoint of new Set((row.hints?.apiPaths||[]).filter(apiLike))){let host='';try{host=new URL(endpoint,row.entry_urls?.[0]).hostname;}catch{}const status=known.get(host)||(commonHosts.test(host)?'通用 ATS／已有采集器':'已发现接口线索，待确认请求参数、主体与分页');leads.push([row.display_name,row.category,row.entry_urls?.[0]||'',endpoint,host,status,row.state]);}
const unique=[];const seen=new Set();for(const lead of leads){const k=lead[0]+'\0'+lead[3];if(!seen.has(k)){seen.add(k);unique.push(lead);}}
await fs.writeFile(path.join(REVIEW,'自研接口线索.csv'),csv(['公司标签','行业','WPS入口','接口线索','主机','结论','页面状态'],unique));

const providers=Object.entries(summary.providers).map(([provider,n])=>`${provider} ${n}`).join('、');
const employerFallback=new Map([['赫力昂','GSK（葛兰素史克）'],['北京兴华','北京网聘信息技术有限公司'],['辰致汽车科技集团','中移铁通'],['中国土木','邮政科学研究规划院有限公司'],['中邮理财','中国邮政储蓄银行股份有限公司']]);
const employerOf=x=>(x.employer_names||[]).join('／')||employerFallback.get(x.display_name)||'无可靠雇主字段';
const rejected=summary.identity_rejected.map(x=>`| ${x.display_name} | ${x.provider} | ${employerOf(x)} | 主体不符或无法安全归并 |`).join('\n');
await fs.writeFile(path.join(REVIEW,'主体不符未准入.csv'),csv(['WPS标签','provider','API返回雇主','入口','原因'],summary.identity_rejected.map(x=>[x.display_name,x.provider,employerOf(x),(x.entry_urls||[]).join('|'),'主体不符或无法安全归并'])));
const report=`# WPS 公司链接深度 API 复核（2026-09-19）

## 结论

- 在首轮 2,080 家公司、2,369 个来源配置的基础上，本轮新增 **${summary.new_companies} 家招聘主体**和 **${summary.new_source_configurations} 个经匿名 API 实测的来源配置**。当前来源库共 **${registry.companies.length} 家公司、${sourceCount} 个来源配置**。
- 新增配置并不只来自飞书、北森；覆盖 Moka、Hotjob、51job XYZ/CoAPI、智联 Grace、Workday、HCMCloud 和公司自研接口。分布为：${providers}。
- **${summary.duplicate_configurations} 个**可用入口与库内已有配置重复，已去重。**${summary.identity_rejected_rows} 个**接口能返回完整 JD，但雇主与 WPS 公司标签不符，已禁止入库。
- 本轮的“可用”仍指：无需登录即可通过公开 HTTP API 取得职责和任职要求。只有单个岗位明确是正式校招时才会进入评估；实习、社招或类型不明的岗位不会冒充正式校招。

## 复核范围

首轮已识别的通用 ATS 之外，本轮对剩余 **${totals.static} 个**公司／链接候选进行页面及静态资源扫描：

- ${totals.read} 个页面成功读取，${totals.unreachable} 个当次访问失败或受限。
- ${totals.apiHints} 个页面的 HTML/脚本中出现 API 路径，${totals.platformHints} 个出现可识别的平台或接口主机线索。
- 从原先被记为“自建页”的链接中还原出 394 个未配置的通用 ATS 上下文，其中 ${count(common,x=>x.admitted)} 个能取得完整 JD。
- 51job/Workday 两组共 ${ready.length+discovered.length} 个候选，${count(ready,x=>x.admitted)+count(discovered,x=>x.admitted)} 个在技术上可取得完整 JD，主体复核后保留 18 个。
- 智联招聘 ${zhaopin.length} 个候选中，${count(zhaopin,x=>x.admitted)} 个可取得完整 JD，主体复核后保留 21 个。
- HCMCloud ${hcm.length} 个入口中，2 个在当前已支持的传输策略下可完整遍历；44 个使用 \`ha\`、2 个使用 \`ha5\`，另有 AES/base64 策略与当次网络失败入口，均未冒充可用来源。

## 新确认的非通用 ATS 接口

- **HCMCloud 公开门户**：已实现 \`hb4\`和明文 \`no\` 传输策略，准入中国有研和中国国际工程咨询有限公司。
- **上海人工智能实验室自研 API**：已实现 \`page_token\`分页，完整遍历 ${shlab.jobs.length} 条校园频道岗位，${shlab.jobs.filter(x=>x.body_complete).length} 条职责和要求完整。当前这些岗位全部是实习，所以来源保留，但本轮正式校招评估为 0。
- **育碧中国自研 API**：能直接返回完整 \`duty\` 和 \`require\`，该采集器已在上一轮来源库中，本轮不重复新增。
- 另外发现了中电科电子、中信证券、中建八局、同花顺、畅唐、海南交规院、河南广电、湖南建投、文华财经等自研接口路径。它们尚需要还原 POST 请求体、签名、租户范围或分页合同，因此只保留为可追溯线索，没有写入正式来源库。

## 主体不符的可访问接口

| WPS 标签 | provider | API 返回雇主 | 处理 |
|---|---|---|---|
${rejected}

## 审阅文件

- [深度复核新增API来源.csv](./深度复核新增API来源.csv)：本轮真正新写入的 ${summary.new_source_configurations} 个配置。
- [主体不符未准入.csv](./主体不符未准入.csv)：接口可读但不能安全归给 WPS 标签公司的记录。
- [自研接口线索.csv](./自研接口线索.csv)：从 HTML 和静态脚本中提取的 ${unique.length} 条可审阅接口线索，包含当前结论。
- [deep-integration-summary.json](./deep-integration-summary.json)：可机读的归并结果。

“未准入”不等于公司没有招聘。它只表示当前没有同时满足“匿名接口可用、完整 JD、主体可核实、分页范围可说明”四个条件。
`;
await fs.writeFile(path.join(REVIEW,'深度API复核报告.md'),report);

const expansionFile=path.join(ROOT,'artifacts/wps-campus-sources-20260919/扩容报告.md');
let expansion=await fs.readFile(expansionFile,'utf8');const marker='## 深度 API 复核';if(!expansion.includes(marker))expansion+=`\n${marker}\n\n随后对所有剩余链接进行了第二轮静态脚本、租户、分页和主体归属复核。在本报告原有 2,080 家公司的基础上，再新增 ${summary.new_companies} 家公司和 ${summary.new_source_configurations} 个 API 配置，当前共 ${registry.companies.length} 家公司、${sourceCount} 个来源配置。详细证据和排除项见 [深度 API 复核报告](./deep-api-review/深度API复核报告.md)。\n`;
await fs.writeFile(expansionFile,expansion);
console.log(JSON.stringify({report:path.join(REVIEW,'深度API复核报告.md'),self_built_leads:unique.length,companies:registry.companies.length,sources:sourceCount},null,2));
