import locationCodes from './location-codes.json' with {type:'json'};
import {normalizeJobLocations} from './locations.mjs';
const mainland=new Set(Object.values(locationCodes.by_code).filter(x=>!['710000','810000','820000'].includes(x.province_code)).map(x=>x.city));
const province=/^(?:Beijing|Shanghai|Tianjin|Chongqing|Hebei|Shanxi|Liaoning|Jilin|Heilongjiang|Jiangsu|Zhejiang|Anhui|Fujian|Jiangxi|Shandong|Henan|Hubei|Hunan|Guangdong|Hainan|Sichuan|Guizhou|Yunnan|Shaanxi|Gansu|Qinghai|Inner Mongolia|Guangxi|Tibet|Ningxia|Xinjiang|China(?: - Remote)?)$/i;
export function mainlandLocationQueries(facets){
 const groups=new Map();
 function walk(f){if(!f||typeof f!=='object')return;
  if(/^(?:locations|locationHierarchy\d*)$/.test(f.facetParameter||'')&&Array.isArray(f.values)){
   const values=f.values.filter(v=>v.id&&typeof v.descriptor==='string'&&(province.test(v.descriptor)||normalizeJobLocations({locations_raw:[v.descriptor]}).cities.some(c=>mainland.has(c)))).map(v=>({id:v.id,label:v.descriptor,count:v.count}));
   if(values.length){const old=groups.get(f.facetParameter)||[];groups.set(f.facetParameter,[...new Map([...old,...values].map(x=>[x.id,x])).values()]);}
  }
  for(const value of Object.values(f))if(value&&typeof value==='object')Array.isArray(value)?value.forEach(walk):walk(value);
 }
 walk(facets);return [...groups].map(([field,values])=>({field,values}));
}
