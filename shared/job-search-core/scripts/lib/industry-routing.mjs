export const INDUSTRIES=Object.freeze([
 {id:'internet',label:'互联网／数字科技',aliases:['互联网','数字科技','互联网/数字科技'],description:'互联网、游戏、AI、软件与云服务等已收录数字科技企业'},
 {id:'smart_hardware',label:'智能硬件',aliases:['硬件','智能终端','智能设备'],description:'智能终端、家电、机器人、无人机及相关硬件企业'},
 {id:'automotive_oem',label:'整车厂',aliases:['车企','主机厂','整车','汽车主机厂'],description:'乘用车、商用车、工程车辆与两轮整车的独立招聘主体'},
 {id:'supply_chain',label:'汽车及电子供应链',aliases:['供应商','汽车供应链','电子供应链','汽车供应商','汽车及电子供应链'],description:'电池、电驱、汽车电子、智驾、零部件、半导体、电子元件及相关设备'},
 {"id":"finance","label":"金融／银行／保险","aliases":["金融","银行","证券","基金","保险"],"description":"已验证公开招聘 API 的金融／银行／保险领域公司及招聘主体"},
 {"id":"energy_environment","label":"能源／电力／环保","aliases":["能源","电力","新能源","环保"],"description":"已验证公开招聘 API 的能源／电力／环保领域公司及招聘主体"},
 {"id":"industrial","label":"工业制造／机械装备","aliases":["工业制造","机械装备","自动化","机械"],"description":"已验证公开招聘 API 的工业制造／机械装备领域公司及招聘主体"},
 {"id":"healthcare","label":"医药／医疗健康","aliases":["医药","医疗","制药","生物医药"],"description":"已验证公开招聘 API 的医药／医疗健康领域公司及招聘主体"},
 {"id":"construction","label":"建筑／地产／基础设施","aliases":["建筑","地产","基建","物业"],"description":"已验证公开招聘 API 的建筑／地产／基础设施领域公司及招聘主体"},
 {"id":"aerospace_transport_equipment","label":"航空航天／船舶／轨道装备","aliases":["航空航天","军工","船舶","轨道装备"],"description":"已验证公开招聘 API 的航空航天／船舶／轨道装备领域公司及招聘主体"},
 {"id":"professional_services","label":"咨询／科研／专业服务","aliases":["咨询","科研","研究所","专业服务","检测认证"],"description":"已验证公开招聘 API 的咨询／科研／专业服务领域公司及招聘主体"},
 {"id":"logistics_trade","label":"交通物流／贸易","aliases":["物流","运输","贸易","航运","快递"],"description":"已验证公开招聘 API 的交通物流／贸易领域公司及招聘主体"},
 {"id":"consumer","label":"消费品／零售／餐饮","aliases":["消费品","快消","零售","餐饮","酒店","服装"],"description":"已验证公开招聘 API 的消费品／零售／餐饮领域公司及招聘主体"},
 {"id":"materials_chemicals","label":"石化／材料／矿冶","aliases":["石化","化工","材料","矿冶","钢铁","造纸"],"description":"已验证公开招聘 API 的石化／材料／矿冶领域公司及招聘主体"},
 {"id":"education","label":"教育／培训","aliases":["教育","培训","学校"],"description":"已验证公开招聘 API 的教育／培训领域公司及招聘主体"},
 {"id":"media_tourism","label":"文化传媒／旅游","aliases":["文化","传媒","旅游","影视","出版","广告"],"description":"已验证公开招聘 API 的文化传媒／旅游领域公司及招聘主体"},
 {"id":"agriculture","label":"农林牧渔","aliases":["农业","农林牧渔","农牧","养殖"],"description":"已验证公开招聘 API 的农林牧渔领域公司及招聘主体"},
 {"id":"telecom","label":"通信／运营商","aliases":["通信","电信","运营商"],"description":"已验证公开招聘 API 的通信／运营商领域公司及招聘主体"},
 {"id":"diversified","label":"综合集团／投资运营","aliases":["综合集团","投资集团","产业运营"],"description":"已验证公开招聘 API 的综合集团／投资运营领域公司及招聘主体"}
]);
const lookup=new Map(INDUSTRIES.flatMap(x=>[x.id,x.label,...x.aliases].map(k=>[k,x.id])));
export function normalizeIndustries(value,{required=true}={}){
 const items=(Array.isArray(value)?value:typeof value==='string'?value.split(/[,，、]/):[]).map(x=>String(x).trim()).filter(Boolean);
 if(!items.length){if(required)throw Error('请先指定行业，可多选：'+INDUSTRIES.map(x=>x.label).join('、')+'；或明确选择“不限行业”。');return [];}
 const normalized=items.map(x=>{if(['all','不限','不限行业','全部行业'].includes(x))return 'all';if(!lookup.has(x))throw Error('未识别的行业：'+x+'；请使用 industries 中的选项。');return lookup.get(x);});
 return normalized.includes('all')?['all']:[...new Set(normalized)];
}
export const industryMatches=(company,filters)=>filters.includes('all')||(company.industry_tags||[]).some(x=>filters.includes(x));
export const industryLabels=ids=>ids.map(id=>id==='all'?'不限行业':INDUSTRIES.find(x=>x.id===id)?.label||id);
export function routeCompanies(sources,filters){return sources.filter(s=>industryMatches(s,normalizeIndustries(filters)));}
