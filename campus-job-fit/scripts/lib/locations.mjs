// Only work-location strings enter this module. Interview locations are not work locations.
import locationCodes from './location-codes.json' with {type:'json'};
const major = ('北京 上海 天津 重庆 武汉 深圳 广州 杭州 南京 苏州 成都 西安 合肥 长沙 郑州 厦门 福州 宁波 无锡 济南 青岛 大连 沈阳 长春 哈尔滨 石家庄 太原 呼和浩特 兰州 银川 西宁 乌鲁木齐 拉萨 贵阳 昆明 南宁 海口 三亚 南昌 南通 常州 扬州 镇江 徐州 盐城 嘉兴 绍兴 湖州 温州 金华 台州 丽水 舟山 衢州 珠海 佛山 东莞 中山 惠州 汕头 湛江 江门 肇庆 清远 南阳 洛阳 新乡 许昌 芜湖 马鞍山 蚌埠 滁州 阜阳 宜昌 襄阳 荆州 黄石 荆门 十堰 鄂州 孝感 黄冈 咸宁 随州 恩施 株洲 湘潭 岳阳 衡阳 常德 泉州 漳州 莆田 龙岩 景德镇 九江 赣州 上饶 淄博 烟台 潍坊 济宁 威海 临沂 东营 泰安 包头 鄂尔多斯 唐山 保定 廊坊 邯郸 秦皇岛 绵阳 德阳 泸州 宜宾 乐山 南充 遵义 曲靖 玉溪 桂林 柳州 北海 香港 澳门 台北 新竹').split(' ');
const english = new Map(Object.entries({beijing:'北京',shanghai:'上海',shenzhen:'深圳',guangzhou:'广州',hangzhou:'杭州',wuhan:'武汉',chengdu:'成都',nanjing:'南京',suzhou:'苏州',xian:'西安',"xi'an":'西安',hefei:'合肥',changsha:'长沙',zhengzhou:'郑州',ningbo:'宁波',xiamen:'厦门',hongkong:'香港','hong kong':'香港',taipei:'台北',singapore:'新加坡',tokyo:'东京',seoul:'首尔',london:'伦敦'}));
const provinces = new Set(('河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 台湾 内蒙古 广西 西藏 宁夏 新疆').split(' '));
// Observed in the public Moonton work-location records, including the district-qualified form.
major.push('吉隆坡');english.set('kuala lumpur','吉隆坡');
export function normalizeLocations(values=[],records=[]) {
  if (!Array.isArray(values)) values=[values];
  const raw=[...new Set(values.flatMap(v=>typeof v==='string'?[v]:[]).map(v=>v.trim()).filter(Boolean))];
  const cities=[],special=[],unresolved=[],codeEvidence=[];
  const mapped=(Array.isArray(records)?records:[]).flatMap(r=>{
    const m=locationCodes.by_code[String(r?.cityId??'')];
    if(!m||!r.cityName||r.cityName!==m.name)return [];
    return [{name:m.name,city:m.city,evidence_id:m.evidence_id,code:String(r.cityId)}];
  });
  for (const full of raw) {
    for (const part of full.split(/[、,，;；/|\n]/).map(x=>x.trim()).filter(Boolean)) {
      if (/面试|宣讲|招聘会/.test(part)) {unresolved.push(part);continue;}
      if (/全国|不限地区|不限城市|工作地点不限/.test(part)) {special.push('全国');continue;}
      if (/远程|remote/i.test(part)) {special.push('远程办公');continue;}
      if (/待定|待确认|未知|按需分配|未确定|unspecified/i.test(part)) {unresolved.push(part);continue;}
      const codes=mapped.filter(m=>part.includes(m.name));
      if(codes.length){cities.push(...codes.map(m=>m.city));codeEvidence.push(...codes);continue;}
      const en=english.get(part.toLowerCase().replace(/,?\s*china$/i,''));
      if (en) {cities.push(en);continue;}
      if([...english.values()].includes(part)){cities.push(part);continue;}
      const known=major.filter(c=>part.includes(c));
      if (known.length) {cities.push(...known);continue;}
      let cleaned=part.replace(/^中国[·\-\s]?/,'').replace(/^[\u4e00-\u9fff]{2,5}省[·\-\s]?/,'');
      const explicit=cleaned.match(/^([\u4e00-\u9fff]{2,7})市/);
      if (explicit&&!provinces.has(explicit[1])) {cities.push(explicit[1]);continue;}
      unresolved.push(part);
    }
  }
  return {raw,cities:[...new Set(cities)],special:[...new Set(special)],unresolved:[...new Set(unresolved)],unknown:!cities.length||unresolved.length>0,code_evidence:codeEvidence};
}
export function normalizeJobLocations(job) {
  let values=job.locations_raw||[];let descriptionEvidence=job.location_description_evidence||[];
  if(!values.length){
    const body=[job.description,job.requirements].filter(Boolean).join('\n');
    descriptionEvidence=[...body.matchAll(/(?:^|[\n（(])(?:工作地点|工作城市|办公地点)\s*[:：]\s*([^\n）)。;；]{1,100})/g)].map(m=>m[1].trim());
    values=[...new Set(descriptionEvidence)];
  }
  return {...normalizeLocations(values,job.raw_metadata?.location_records),description_evidence:descriptionEvidence};
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
