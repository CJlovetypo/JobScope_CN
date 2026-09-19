// Structured work locations and explicit job-title annotations are separate evidence sources.
import locationCodes from './location-codes.json' with {type:'json'};
const major = ('北京 上海 天津 重庆 武汉 深圳 广州 杭州 南京 苏州 成都 西安 合肥 长沙 郑州 厦门 福州 宁波 无锡 济南 青岛 大连 沈阳 长春 哈尔滨 石家庄 太原 呼和浩特 兰州 银川 西宁 乌鲁木齐 拉萨 贵阳 昆明 南宁 海口 三亚 南昌 南通 常州 扬州 镇江 徐州 盐城 嘉兴 绍兴 湖州 温州 金华 台州 丽水 舟山 衢州 珠海 佛山 东莞 中山 惠州 汕头 湛江 江门 肇庆 清远 南阳 洛阳 新乡 许昌 芜湖 马鞍山 蚌埠 滁州 阜阳 宜昌 襄阳 荆州 黄石 荆门 十堰 鄂州 孝感 黄冈 咸宁 随州 恩施 株洲 湘潭 岳阳 衡阳 常德 泉州 漳州 莆田 龙岩 景德镇 九江 赣州 上饶 淄博 烟台 潍坊 济宁 威海 临沂 东营 泰安 包头 鄂尔多斯 唐山 保定 廊坊 邯郸 秦皇岛 绵阳 德阳 泸州 宜宾 乐山 南充 遵义 曲靖 玉溪 桂林 柳州 北海 香港 澳门 台北 新竹').split(' ');
const english = new Map(Object.entries({beijing:'北京',shanghai:'上海',shenzhen:'深圳',guangzhou:'广州',hangzhou:'杭州',wuhan:'武汉',chengdu:'成都',nanjing:'南京',suzhou:'苏州',xian:'西安',"xi'an":'西安',hefei:'合肥',changsha:'长沙',zhengzhou:'郑州',ningbo:'宁波',xiamen:'厦门',hongkong:'香港','hong kong':'香港',taipei:'台北',singapore:'新加坡',tokyo:'东京',seoul:'首尔',london:'伦敦'}));
const provinces = new Set(('河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 台湾 内蒙古 广西 西藏 宁夏 新疆').split(' '));
// Observed in the public Moonton work-location records, including the district-qualified form.
major.push('吉隆坡');english.set('kuala lumpur','吉隆坡');
// Confirmed verbatim by SHEIN 3072 (Location: Whitestown, Indiana, U.S.) and
// TravelSky 6a2a25583d5b657f38c3e36d (常驻漠河工作); retain their original names.
major.push('漠河');english.set('whitestown','Whitestown');
// Standard, unambiguous city spellings observed in the pending work-location fields.
// No district-to-city inference or employer/headquarters lookup is involved.
for(const [name,city] of Object.entries({dalian:'大连',nantong:'南通',wuxi:'无锡',langfang:'廊坊',weifang:'潍坊',zhongwei:'中卫',
  seattle:'西雅图','palo alto':'帕洛阿尔托',sunnyvale:'森尼韦尔','culver city':'库尔弗城','mexico city':'墨西哥城',
  'sao paulo':'圣保罗','são paulo':'圣保罗',riyadh:'利雅得',dubai:'迪拜',jakarta:'雅加达'}))english.set(name,city);
const codeEntries=Object.values(locationCodes.by_code);
// Explicit city spellings observed in current Workday/SmartRecruiters work-location fields.
for(const [name,city] of Object.entries({tianjin:'天津',chongqing:'重庆',foshan:'佛山',huizhou:'惠州',changzhou:'常州',wuhu:'芜湖',qingdao:'青岛',shenyang:'沈阳',dongguan:'东莞',changchun:'长春',jiaxing:'嘉兴',zhenjiang:'镇江',yancheng:'盐城',zhuhai:'珠海',taicang:'苏州',kunshan:'苏州',changshu:'苏州','shang hai':'上海','shang hai shi':'上海','su zhou shi':'苏州','wu xi shi':'无锡','tian jin shi':'天津','bei jing shi':'北京','nan jing shi':'南京','he fei shi':'合肥','guang zhou shi':'广州','shen zhen shi':'深圳'}))english.set(name,city);
const knownCities=[...new Set([...major,...codeEntries.map(m=>m.city),...english.values()])];
const titleAliases=new Map([...knownCities.map(c=>[c,c]),...english]);
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const titleCityPattern=[...titleAliases.keys()].sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|');
const organization=/(?:大学|大學|学院|學院|学校|學校|公司|集团|集團|银行|研究院|研究所|事务所|\b(?:university|college|company|corporation|inc|ltd|bank)\b)/i;
const nonWorkContext=/(?:面试|笔试|宣讲|招聘会|双选会|见面会|面談|采访|採訪|interview|career\s*fair)/i;
const workLabel=/(?:工作(?:地点|城市)|办公地点|base(?:d)?(?:\s+in)?|work\s*location|location)\s*[:：]?\s*$/i;
// A city attached to a recognizable role is also an annotation (e.g. 太原博文素养教师).
// These prefixes locate title evidence only; they never classify or score a job.
const rolePrefix=/^(?:项目|产品|研发|开发|测试|软件|算法|工程师|技术|数据|交付|售前|销售|营销|市场|运营|客服|客户|财务|会计|人力|人事|招聘|行政|管培|管理培训|教师|老师|教学|学习|课程|考研|高中|初中|小学|少儿|儿童|博文|双语|素养|海淘校招|校[园園](?:品牌)?大使|\s+(?:engineer|developer|sales|operations|product|project|customer|graduate)\b)/i;
const provinceNames=[...new Set(codeEntries.map(m=>m.province))];
const provincePrefix=new RegExp('^(?:'+[...new Set([...provinceNames,...[...provinces].map(p=>p+'省'),...provinces])]
  .sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|')+')[·\\-\\s]*');
const provinceOf=text=>[...provinces].find(p=>text===p||text===p+'省'||provinceNames.some(n=>n===text&&n.startsWith(p)));
const cityInProvince=(city,province)=>codeEntries.some(m=>m.city===city&&m.province.startsWith(province));
const englishCityPattern=[...english.keys()].sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|');
function englishMatches(text){
  return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(?:${englishCityPattern})(?![\\p{L}\\p{N}])`,'giu'))];
}
// These may qualify a named city in the SAME address, but never imply a city on their own.
const addressComponent=/^(?:china|cn|chn|hong kong sar|hong kong island|united kingdom|uk|us|usa|united states|hebei|shanxi|liaoning|jilin|heilongjiang|jiangsu|zhejiang|anhui|fujian|jiangxi|shandong|henan|hubei|hunan|guangdong|hainan|sichuan|guizhou|yunnan|shaanxi|gansu|qinghai|taiwan|inner mongolia|guangxi|tibet|ningxia|xinjiang)$/i;

function parseWorkLocation(full,mapped=[]){
  const cities=[],special=[],unresolved=[],codeEvidence=[],evidence=[];
  if(nonWorkContext.test(full)||organization.test(full))return {cities,special,unresolved:[full],codeEvidence,evidence};
  const contextual=[];
  for(const part of full.split(/[、,，;；/|\n]/).map(x=>x.trim()).filter(Boolean)){
    if(/全国|不限地区|不限城市|工作地点不限/.test(part)){special.push('全国');continue;}
    if(/远程|\b(?:remote|virtual)\b/i.test(part))special.push('远程办公');
    if(/待定|待确认|未知|按需分配|未确定|unspecified/i.test(part)){unresolved.push(part);continue;}
    const codes=mapped.filter(m=>part.includes(m.name));
    const found=codes.map(m=>m.city);codeEvidence.push(...codes);
    for(const match of englishMatches(part))found.push(english.get(match[0].toLowerCase()));
    for(const city of knownCities){
      const index=part.indexOf(city);
      if(index>=0&&!/^[东西南北中]?(?:路|街|大道)/.test(part.slice(index+city.length)))found.push(city);
    }
    if(!found.length){
      const cleaned=part.replace(/^中国[·\-\s]?/,'').replace(provincePrefix,'');
      const explicit=cleaned.match(/^([\u4e00-\u9fff]{2,7})市/);
      if(explicit&&!provinces.has(explicit[1]))found.push(explicit[1]);
    }
    if(found.length){
      const names=[...new Set(found)];cities.push(...names);
      evidence.push({text:part,cities:names,rule:codes.length?'verified_location_code':'named_work_location'});
    }else if(addressComponent.test(part))contextual.push(part);
    else if(!/^(?:远程(?:办公)?|remote|virtual)$/i.test(part))unresolved.push(part);
  }
  if(!cities.length)unresolved.push(...contextual);
  return {cities,special,unresolved,codeEvidence,evidence};
}

function mappedRecords(records){
  return (Array.isArray(records)?records:[]).flatMap(r=>{
    const m=locationCodes.by_code[String(r?.cityId??'')];
    if(!m||!r.cityName||r.cityName!==m.name)return [];
    return [{name:m.name,city:m.city,evidence_id:m.evidence_id,code:String(r.cityId)}];
  });
}

/**
 * Return JSON-serializable, current-title evidence. Offsets use JS UTF-16 indices
 * and satisfy title.slice(start,end) === text. Never feed a whole title through
 * normalizeLocations: its permissive address matching would accept employer names.
 */
export function extractTitleLocations(title='') {
  if(typeof title!=='string'||!title.trim())return [];
  const evidence=[];
  // Keep spaces inside a clause so English place names and employer names remain intact.
  for(const clause of title.matchAll(/[^\n（）()【】\[\]{}、,，;；/|·—–_\-]+/g)){
    if(organization.test(clause[0])||nonWorkContext.test(clause[0]))continue;
    for(const match of clause[0].matchAll(new RegExp(titleCityPattern,'gi'))){
      const city=titleAliases.get(match[0].toLowerCase());
      const before=clause[0].slice(0,match.index),after=clause[0].slice(match.index+match[0].length);
      // Do not find xian inside an English word, or a city inside a Chinese name.
      if(/[a-z]/i.test(match[0])&&(/[a-z]$/i.test(before)||/^[a-z]/i.test(after)))continue;
      const prefix=before.trim();
      const explicit=workLabel.test(before);
      const province=provinceOf(prefix.replace(/^中国\s*/,''));
      const startBoundary=!prefix||explicit||(province&&cityInProvince(city,province));
      // A city may also be a separate word at the end of an English role title.
      const englishSuffix=/\s$/.test(before)&&/^[\x00-\x7f]+$/.test(before)&&!after.trim();
      if(!startBoundary&&!englishSuffix)continue;
      let suffix=after;
      if(suffix.startsWith('市')&&!suffix.startsWith('市场'))suffix=suffix.slice(1);
      const district=codeEntries.find(m=>m.level==='district'&&m.city===city&&suffix.startsWith(m.name));
      if(district)suffix=suffix.slice(district.name.length);
      if(!/^\s*(?:(?:地区|岗位|岗|办公|常驻|常駐|base)\s*)?$/i.test(suffix)&&!rolePrefix.test(suffix))continue;
      // Event cities do not become workplaces; an explicit work label can still qualify.
      if(nonWorkContext.test(title)&&!explicit)continue;
      // In “某某（北京）有限公司”, the parenthesized city belongs to the employer name.
      const rest=title.slice(clause.index+clause[0].length);
      if(/^[）)\]】]\s*(?:有限|股份|科技|技术|信息|网络|集团|公司|大学|学院|university|ltd|inc)/i.test(rest))continue;
      const start=clause.index+match.index;
      const end=start+match[0].length+(after.length-suffix.length);
      evidence.push({source:'title',title,text:title.slice(start,end),start,end,cities:[city],
        rule:explicit?'explicit_work_location':suffix.trim()?'city_role_prefix':'delimited_city'});
    }
  }
  return evidence;
}
export function normalizeLocations(values=[],records=[]) {
  if (!Array.isArray(values)) values=[values];
  const raw=[...new Set(values.filter(v=>typeof v==='string'&&v.trim()))];
  const cities=[],special=[],unresolved=[],codeEvidence=[],structuredEvidence=[];
  const mapped=mappedRecords(records);
  const merge=parsed=>{cities.push(...parsed.cities);special.push(...parsed.special);unresolved.push(...parsed.unresolved);codeEvidence.push(...parsed.codeEvidence);};
  for(let i=0;i<raw.length;i++){
    let full=raw[i].trim();const sourceValues=[raw[i]];
    // Repair only a known city crossing a provider's split boundary, or the exact
    // observed country split “United” + “Kingdom-London”. Keep both original values.
    const next=raw[i+1],joined=next?full+' '+next:'';
    if(next&&!/^[{[]/.test(full)&&!/[{[]/.test(next)&&(
      englishMatches(joined).some(m=>m.index<full.length&&m.index+m[0].length>full.length+1)||
      (full==='United'&&/^Kingdom-/.test(next)&&englishMatches(next).length))){
      full=joined;sourceValues.push(next);i++;
    }
    if(/^[{[]/.test(full)){
      const original=sourceValues[0];
      let value;try{value=JSON.parse(full);}catch{unresolved.push(original);continue;}
      const entries=Array.isArray(value)?value:[value];
      for(const [index,entry] of entries.entries()){
        if(!entry||typeof entry!=='object'||nonWorkContext.test(String(entry.type||''))){unresolved.push(full);continue;}
        let keys=['normalizedCityName','city','cityName'].filter(k=>typeof entry[k]==='string'&&entry[k].trim());
        if(!keys.length)keys=['normalizedLocation','location'].filter(k=>typeof entry[k]==='string'&&entry[k].trim());
        if(!keys.length){unresolved.push(full);continue;}
        const fields=[];
        for(const key of keys){
          const parsed=parseWorkLocation(entry[key],mappedRecords([entry]));merge(parsed);
          const field={source:'locations_raw_json',raw:original,pointer:(Array.isArray(value)?'/'+index:'')+'/'+key,
            value:entry[key],cities:[...new Set(parsed.cities)],special:[...new Set(parsed.special)],rule:'json_city_field'};
          fields.push(field);structuredEvidence.push(field);
        }
        if(/^(?:virtual|remote)$/i.test(entry.type||'')){
          special.push('远程办公');structuredEvidence.push({source:'locations_raw_json',raw:original,
            pointer:(Array.isArray(value)?'/'+index:'')+'/type',value:entry.type,cities:[],special:['远程办公'],rule:'json_work_mode'});
        }
        const sets=fields.filter(f=>f.cities.length).map(f=>[...f.cities].sort().join('|'));
        if(new Set(sets).size>1){
          unresolved.push(full);
          for(const field of fields)field.field_disagreement=true;
        }
      }
      continue;
    }
    const parsed=parseWorkLocation(full,mapped);merge(parsed);
    structuredEvidence.push(...parsed.evidence.map(e=>({source:'locations_raw',raw_values:sourceValues,...e})));
  }
  return {raw,cities:[...new Set(cities)],special:[...new Set(special)],unresolved:[...new Set(unresolved)],
    unknown:!cities.length||unresolved.length>0,code_evidence:codeEvidence,structured_evidence:structuredEvidence};
}
export function normalizeJobLocations(job) {
  const values=job.locations_raw||[];
  let result=normalizeLocations(values,job.raw_metadata?.location_records);
  let descriptionEvidence=job.location_description_evidence||[];
  let bodyLocations=normalizeLocations([]);
  // Explicit body locations can add another work city even if a field is partly known.
  {
    const body=[job.description,job.requirements].filter(Boolean).join('\n');
    descriptionEvidence=[...body.matchAll(/(?:^|[\n（(])(?:工作地点|工作城市|办公地点)\s*[:：]\s*([^\n）)。;；]{1,100})/g)].map(m=>m[1].trim());
    bodyLocations=normalizeLocations([...new Set(descriptionEvidence)],job.raw_metadata?.location_records);
    bodyLocations.structured_evidence=bodyLocations.structured_evidence.map(e=>({...e,source:'description'}));
    if(!result.raw.length)result={...bodyLocations,raw:result.raw};
    else result={...result,cities:[...new Set([...result.cities,...bodyLocations.cities])],special:[...new Set([...result.special,...bodyLocations.special])],
      unresolved:[...new Set([...result.unresolved,...bodyLocations.unresolved])],
      code_evidence:[...result.code_evidence,...bodyLocations.code_evidence],
      structured_evidence:[...result.structured_evidence,...bodyLocations.structured_evidence]};
  }
  const titleEvidence=extractTitleLocations(job.title);
  const titleCities=[...new Set(titleEvidence.flatMap(e=>e.cities))];
  // Preserve existing structured cities too, including callers that have no raw field.
  // Keep all raw source strings separate from title text for repeatable enrichment.
  const previousTitleOnly=new Set((job.location_title_evidence||[]).flatMap(e=>e.added_cities||[]));
  const saved=normalizeLocations((Array.isArray(job.cities)?job.cities:job.cities?[job.cities]:[])
    .filter(c=>!previousTitleOnly.has(c)||result.cities.includes(c)));
  const cities=[...new Set([...result.cities,...saved.cities,...titleCities])];
  const unresolved=[...new Set([...result.unresolved,...saved.unresolved.filter(p=>!result.cities.includes(p))])].filter(part=>{
    const province=provinceOf(part);
    const matching=province?titleEvidence.filter(e=>e.cities.some(c=>cityInProvince(c,province))):[];
    for(const e of matching)e.resolves=[...(e.resolves||[]),part];
    const bodyCities=province?bodyLocations.cities.filter(c=>cityInProvince(c,province)):[];
    if(bodyCities.length)result.structured_evidence.push({source:'description',text:descriptionEvidence.join('\n'),
      cities:bodyCities,resolves:[part],rule:'province_refined_by_body'});
    // A matching province-only field is refined by the title, not silently thrown away.
    return !matching.length&&!bodyCities.length;
  });
  const addressEvidence=[];
  const remaining=unresolved.filter(part=>{
    // A separate address line can refine an already explicit city. This does NOT
    // resolve an unqualified district into a new city or invent an incoming cityId.
    const district=codeEntries.find(m=>m.level==='district'&&cities.includes(m.city)&&part.startsWith(m.name));
    if(!district)return true;
    addressEvidence.push({source:'locations_raw',text:part,cities:[district.city],
      rule:'district_detail_of_named_city',evidence_id:district.evidence_id});
    return false;
  });
  const fieldCities=[...new Set([...result.cities,...saved.cities])];
  for(const e of titleEvidence){
    e.field_cities=fieldCities;
    e.added_cities=e.cities.filter(c=>!fieldCities.includes(c));
    e.differs_from_fields=fieldCities.length>0&&e.added_cities.length>0;
  }
  return {...result,cities,unresolved:remaining,unknown:!cities.length||remaining.length>0,
    structured_evidence:[...result.structured_evidence,...saved.structured_evidence.map(e=>({...e,source:'cities'})),...addressEvidence],
    description_evidence:descriptionEvidence,title_evidence:titleEvidence};
}
export function normalizeCityFilters(values=[]) {
  const result=normalizeLocations(values);
  if (result.unresolved.length||result.special.length) throw new Error('城市筛选需明确城市名称，不能用全国、远程或未识别区域：'+values.join('、'));
  return result.cities;
}
export function companyCityMatches(tags,filters) {return !filters.length||filters.some(c=>(tags?.cities||[]).includes(c));}
export function jobCityStatus(job,filters) {
  if (!job.cities?.length&&!job.location_special?.length) return 'unknown';
  if (!filters.length) return 'included';
  if ((job.cities||[]).some(c=>filters.includes(c))) return 'included';
  if (!job.cities?.length||job.location_unknown||job.location_special?.length) return 'unknown';
  return 'excluded';
}
