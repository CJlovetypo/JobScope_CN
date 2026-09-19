import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from './lib/http.mjs';

const skillRoot=path.resolve(import.meta.dirname,'..');
const output=path.resolve(process.argv[2]||path.join(skillRoot,'artifacts/wps-campus-sources-20260919/deep-api-review/round4-recursive-discovery'));
await fs.mkdir(output,{recursive:true});

const candidates=[
  ['浙江建投','https://hr.cnzgc.com/'],
  ['中国医学科学院','https://job.pumc.edu.cn/job/index.html#/?companyCode=1000'],
  ['BDA咨询','http://wx.bda.com/career/job.php?id=2'],
  ['住建部直属事业单位','http://gkzp.mochr.com/#/home/login'],
  ['惠科股份','http://joinus.hkcqjy.com.cn/'],
  ['中物院软件中心','http://www.caep-scns.ac.cn/job_list.php'],
  ['湖南建投集团','https://www.hnrcsc.com/nfs/2025hnjt/position-jobs'],
  ['芬欧汇川UPM','https://www.upm.com/people-and-careers/students-and-graduates/upm-graduate-program/'],
];
const uniq=values=>[...new Set(values.filter(Boolean))];
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);

function assets(text,base,origin){
  const found=[];
  for(const pattern of [
    /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*(["'])(.*?)\1/gi,
    /["'`]([^"'`\s]{1,260}\.m?js(?:[?#][^"'`\s]*)?)["'`]/gi,
  ])for(const match of text.matchAll(pattern)){
    const value=match[2]||match[1];
    try{const url=new URL(value,base);if(url.origin===origin&&/\.m?js(?:[?#]|$)/i.test(url.href))found.push(url.href);}catch{/* ignore */}
  }
  return uniq(found);
}

function scan(text,base){
  const endpoints=[],windows=[];
  for(const pattern of [
    /["'`]((?:https?:)?\/\/[^"'`\s\\]{4,350})["'`]/gi,
    /["'`]((?:\/(?:api|admin|gateway|openapi|recruit|hr|job|position|campus|zp)[^"'`\s\\]{1,320}))["'`]/gi,
    /(?:baseURL|baseUrl|BASE_URL|apiHost|apiUrl|requestUrl)\s*[:=]\s*["'`]([^"'`]{2,300})["'`]/gi,
  ])for(const match of text.matchAll(pattern)){
    const value=match[1];if(!/(api|admin|job|position|post|recruit|career|campus|hr|zp|notice|activity|apply)/i.test(value))continue;
    try{endpoints.push(new URL(value,base).href);}catch{endpoints.push(value);}
  }
  for(const match of text.matchAll(/.{0,220}(?:recruit-api|Query_RecruitmentNotice|findAfootTitle|listActivityRecruit|job_list\.php|position|jobList|recruitment|vacanc).{0,320}/gi)){
    windows.push(match[0].replace(/\s+/g,' ').slice(0,560));if(windows.length>=300)break;
  }
  return {endpoints:uniq(endpoints),windows:uniq(windows)};
}

async function inspect([company,entry]){
  const dir=path.join(output,`${company}-${hash(entry)}`),client=createClient({evidenceDir:path.join(dir,'http'),timeoutMs:25000});
  const result={company,entry,checked_at:new Date().toISOString(),resources:[],endpoints:[],route_windows:[],limits:{max_assets:60,max_depth:3}};
  try{
    const page=await client.request({url:entry,headers:{Accept:'text/html,application/xhtml+xml,*/*'}},{purpose:'round4_public_recruitment_page'});
    result.page={status:page.record.http_status,final_url:page.url,response_file:page.record.response_file};
    if(page.record.http_status===200){
      const origin=new URL(page.url).origin,first=scan(page.text,page.url);result.endpoints.push(...first.endpoints);result.route_windows.push(...first.windows);
      const queue=assets(page.text,page.url,origin).map(url=>({url,depth:1})),seen=new Set();
      while(queue.length&&seen.size<60){const item=queue.shift();if(seen.has(item.url))continue;seen.add(item.url);
        try{const response=await client.request({url:item.url,headers:{Referer:page.url,Accept:'*/*'}},{purpose:'round4_recursive_frontend_asset'});
          result.resources.push({url:item.url,depth:item.depth,status:response.record.http_status,bytes:Buffer.byteLength(response.text),response_file:response.record.response_file});
          if(response.record.http_status===200){const found=scan(response.text,item.url);result.endpoints.push(...found.endpoints);result.route_windows.push(...found.windows);
            if(item.depth<3)for(const url of assets(response.text,item.url,origin))if(!seen.has(url))queue.push({url,depth:item.depth+1});}
        }catch(error){result.resources.push({url:item.url,depth:item.depth,error:error.message});}
      }
      result.discovery_truncated=queue.length>0;
    }
  }catch(error){result.error=error.message;}
  result.endpoints=uniq(result.endpoints).sort();result.route_windows=uniq(result.route_windows).slice(0,500);
  await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'discovery.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({company,page:result.page?.status||result.error,resources:result.resources.length,endpoints:result.endpoints.length,truncated:result.discovery_truncated||false}));return result;
}

const results=[];let cursor=0;
await Promise.all(Array.from({length:2},async()=>{while(cursor<candidates.length)results.push(await inspect(candidates[cursor++]));}));
results.sort((a,b)=>a.company.localeCompare(b.company,'zh-CN'));
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({reviewed:results.length,pages_ok:results.filter(x=>x.page?.status===200).length,resources:results.reduce((n,x)=>n+x.resources.length,0),endpoints:results.reduce((n,x)=>n+x.endpoints.length,0)},null,2));
