import {datasetPath} from '../../shared/job-search-core/registry.mjs';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tagsPath = datasetPath(root,'data/company-ownership-tags.json');
const registryPaths = [
  path.join(root, "artifacts", "api-expansion-2", "registry-companies.json"),
  path.join(root, "artifacts", "api-expansion-2", "root-recall.json"),
  path.join(root, "artifacts", "api-expansion-2", "games", "registry-game-recall.json"),
];
const checkedAt = "2026-09-07";

const aliases = new Map(Object.entries({
  "新浪与微博": "新浪&微博",
  "转转": "转转集团",
  "途牛": "途牛旅游网",
  "T3 出行": "T3出行",
  "猿辅导": "猿辅导集团",
  "利欧数字": "利欧集团",
  "赛美特": "赛美特集团",
  "心动／TapTap": "心动×TapTap",
  "英雄电竞": "英雄电竞-管培生",
  "沐瞳科技": "沐瞳",
  "荔枝集团": "荔枝集团-AI技术专场",
  "如涵": "如涵MCN",
}));

const sourceTagMap = new Map([
  ["民营企业", "私企"],
  ["央国企", "国企"],
  ["国有企业", "国企"],
  ["外企", "外企"],
  ["外资企业", "外企"],
]);

const manual = new Map(Object.entries({
  "零一万物": {
    ownership_tag: "待核实",
    status: "verified_unresolved",
    reason: "已核对公司官网与公开工商摘要：官网只确认由李开复创立，未披露当前控制关系；工商摘要显示境内主体为外商投资企业法人独资，但未展示穿透后的最终控制人。按集团控制口径无法可靠归入私企或外企。",
    evidence: [
      { url: "https://www.lingyiwanwu.com/about.html", title: "零一万物官网：关于我们", note: "官网确认公司成立、总部和创始人，但未披露股权或最终控制关系。", checked_at: checkedAt },
      { url: "https://m.qcc.com/firm/ee15db324d0b7eb2ebeccb092dbd8f45.html", title: "北京零一万物科技有限公司工商信息摘要", note: "公开摘要显示境内主体为外商投资企业法人独资，但未给出可据以判断最终控制性质的完整穿透链。", checked_at: checkedAt },
    ],
  },
  "百川智能": {
    ownership_tag: "私企",
    status: "verified",
    reason: "已核对百川智能对应的北京主体；公开工商信息显示企业类型为有限责任公司（自然人投资或控股），按当前境内用人主体归为私企。",
    evidence: [
      { url: "https://www.tianyancha.com/company/6005364573", title: "百川智能科技有限公司工商信息", note: "页面列示统一社会信用代码 91110108MACBM7E07B，企业类型为有限责任公司（自然人投资或控股）。", checked_at: checkedAt },
    ],
  },
  "Soul": {
    ownership_tag: "私企",
    status: "verified",
    reason: "Soul 官网确认运营主体为上海任意门科技有限公司，并明确公司获得“上海市民营企业总部”荣誉，按官方自述归为私企。",
    evidence: [
      { url: "https://www.soulapp.cn/about", title: "Soul App 官网：关于我们", note: "官网确认上海任意门为运营主体，并列明“上海市民营企业总部”荣誉。", checked_at: checkedAt },
    ],
  },
  "创梦天地": {
    ownership_tag: "待核实",
    status: "verified_unresolved",
    reason: "已核对当前官方招聘入口并检索公司年报/控股股东资料；可确认境内招聘主体与港股上市集团关联，但本轮未取得可直接支持国企、私企或外企三分法的最终控制关系原文，上市地与腾讯参股均不能替代性质判断。",
    evidence: [
      { url: "https://idreamsky.jobs.feishu.cn/index", title: "创梦天地官方招聘入口", note: "已确认品牌与当前招聘主体；招聘源未返回公司性质字段。", checked_at: checkedAt },
    ],
  },
  "厦门他趣": {
    ownership_tag: "待核实",
    status: "verified_unresolved",
    reason: "已核对当前官方招聘入口并检索企业性质；招聘源未提供性质字段，公开检索未取得当前签约主体的最终控制关系原文，不能只凭品牌、创始人或融资信息归类。",
    evidence: [
      { url: "https://o15vj1m4ie.jobs.feishu.cn/index", title: "厦门他趣官方招聘入口", note: "已确认当前招聘品牌与职位入口；源记录无公司性质字段。", checked_at: checkedAt },
    ],
  },
  "恺英网络": {
    ownership_tag: "待核实",
    status: "verified_unresolved",
    reason: "已核对当前官方招聘入口并检索年度报告与实际控制人信息；招聘源未提供性质字段，本轮未稳定取得年度报告控制关系原文，因此不以A股上市身份直接推断私企。",
    evidence: [
      { url: "https://app.mokahr.com/campus_apply/kingnet/2246#/", title: "恺英网络官方招聘入口", note: "已确认当前招聘主体入口；源记录无公司性质字段。", checked_at: checkedAt },
    ],
  },
  "IGG": {
    ownership_tag: "待核实",
    status: "verified_unresolved",
    reason: "已核对 IGG 官网并检索年度报告控制关系；可确认其为境外注册并上市的游戏集团，但尚未取得上海招聘主体与集团最终控制关系的直接材料，境外注册/上市不自动等同外企。",
    evidence: [
      { url: "https://www.igg.com/", title: "IGG 官方网站", note: "官网可确认品牌和集团身份，但当前页面不足以确定上海用人主体在三分法下的控制性质。", checked_at: checkedAt },
    ],
  },
  "明略科技": {
    ownership_tag: "待核实",
    status: "verified_unresolved",
    reason: "已核对当前官方招聘入口并检索企业性质；招聘源未提供性质字段，现有官网业务资料与融资报道均不能替代最终控制关系，故确认后保留待核实。",
    evidence: [
      { url: "https://mininglamp.zhiye.com/", title: "明略科技官方招聘入口", note: "已确认当前招聘入口；源记录无公司性质字段。", checked_at: checkedAt },
    ],
  },
}));

const tags = JSON.parse(fs.readFileSync(tagsPath, "utf8"));
const registry = registryPaths.flatMap((p) => JSON.parse(fs.readFileSync(p, "utf8")));
const registryByName = new Map();
for (const item of registry) {
  if (!registryByName.has(item.name_canonical)) registryByName.set(item.name_canonical, item);
}

let fromRegistry = 0;
let unresolvedFromConflict = 0;
let manualCount = 0;
const unmatched = [];

for (const company of tags.companies) {
  if (company.status !== "unknown") continue;
  const manualRecord = manual.get(company.display_name);
  if (manualRecord) {
    Object.assign(company, manualRecord, { checked_at: checkedAt });
    manualCount += 1;
    continue;
  }

  const sourceName = aliases.get(company.display_name) ?? company.display_name;
  const source = registryByName.get(sourceName);
  const rawNatures = [...new Set((source?.natures ?? []).filter(Boolean))];
  const mapped = [...new Set(rawNatures.map((value) => sourceTagMap.get(value)).filter(Boolean))];
  const url = source?.endpoints?.find((endpoint) => endpoint.url_canonical)?.url_canonical;
  if (!source || rawNatures.length === 0 || !url || mapped.length === 0) {
    unmatched.push(company.display_name);
    continue;
  }

  if (mapped.length > 1) {
    company.ownership_tag = "待核实";
    company.status = "verified_unresolved";
    company.reason = `已核对招聘数据源，${sourceName} 同时出现互相冲突的公司性质标签：${rawNatures.join("、")}；在未取得控制关系原文前不强行归类。`;
    unresolvedFromConflict += 1;
  } else {
    company.ownership_tag = mapped[0];
    company.status = "verified";
    company.reason = `招聘数据源已为 ${sourceName} 标注公司性质“${rawNatures.join("、")}”，按数据源预标注映射为“${mapped[0]}”。`;
    fromRegistry += 1;
  }
  company.checked_at = checkedAt;
  company.evidence = [{
    url,
    title: `招聘数据源结构化公司性质字段：${sourceName}`,
    note: `源记录 natures=${JSON.stringify(rawNatures)}；该字段语义为 supplier_company_nature_classification，关联招聘入口如上。`,
    checked_at: checkedAt,
  }];
}

if (unmatched.length > 0) {
  throw new Error(`仍有未补齐公司：${unmatched.join("、")}`);
}

tags.updated_at = new Date().toISOString();
fs.writeFileSync(tagsPath, `${JSON.stringify(tags, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ from_registry: fromRegistry, unresolved_from_conflict: unresolvedFromConflict, manual: manualCount, total: fromRegistry + unresolvedFromConflict + manualCount }, null, 2));
