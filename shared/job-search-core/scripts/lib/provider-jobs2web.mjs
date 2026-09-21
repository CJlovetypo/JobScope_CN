import {createClient} from './http.mjs';
import {bodyText} from './body-review.mjs';
import {normalizeJobLocations} from './locations.mjs';

const decode=x=>bodyText(x).replace(/&hellip;/g,'…');
export function parseJobs2webList(html,base,{fragmentTotal=null}={}){
  const rows=[];
  const blocks=[...html.matchAll(/<tr\b[^>]*class=["'][^"']*\bdata-row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi),...html.matchAll(/<li\b[^>]*class=["'][^"']*\bjob-tile\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)];
  for(const match of blocks){
    const block=match[1],anchor=[...block.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(x=>/\/job\//.test(x[1]));
    if(!anchor)throw Error('Jobs2Web row missing job link');
    const url=new URL(decode(anchor[1]),base),id=url.pathname.match(/\/(\d+)\/?$/)?.[1];
    if(url.origin!==new URL(base).origin||!id)throw Error('Jobs2Web row has invalid job identity');
    const locations=[...new Set([...block.matchAll(/<span\b[^>]*class=["'][^"']*\bjobLocation\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi),...block.matchAll(/<div\b[^>]*id=["'][^"']*-section-location-value["'][^>]*>([\s\S]*?)<\/div>/gi)].map(x=>decode(x[1])))];
    rows.push({id,title:decode(anchor[2]),url:url.href,locations});
  }
  const label=html.match(/class=["']paginationLabel["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
  const totalText=label&&[...label.matchAll(/<b>([\s\S]*?)<\/b>/gi)].at(-1)?.[1];
  let total=totalText?Number(decode(totalText).replace(/[,\s]/g,'')):null;
  if(total===null){const tileLabel=html.match(/id=["']tile-search-results-label["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];const n=decode(tileLabel||'').match(/\bof\s+([\d,]+)\s+Jobs/i)?.[1];if(n)total=Number(n.replaceAll(',',''));}
  const empty=/id=["']noresults["']/.test(html)&&/no (?:jobs|results)|0 results|没有|未找到/i.test(decode(html));
  if(total===null&&empty)total=0;
  // The observed load-more endpoint returns only tiles; its total is on the parent page.
  if(total===null&&rows.length&&new URL(base).pathname==='/tile-search-results/'&&Number.isSafeInteger(fragmentTotal))total=fragmentTotal;
  if(total===null||!Number.isSafeInteger(total)||total<0)throw Error('Jobs2Web total missing or unrecognized response');
  const next=[...html.matchAll(/href=["']([^"']*startrow=[^"']+)["']/gi)].map(x=>new URL(decode(x[1]),base)).filter(x=>x.origin===new URL(base).origin&&x.pathname===new URL(base).pathname);
  let tiles=null;
  const init=html.match(/j2w\.SearchResults\.init\(\{([\s\S]*?)\}\)/)?.[1];
  if(init){const endpoint=init.match(/apiEndpoint:\s*["']([^"']+)["']/)?.[1],query=init.match(/searchQuery:\s*["']([^"']+)["']/)?.[1],size=Number(init.match(/jobRecordsPerPage:\s*parseInt\(["'](\d+)["']\)/)?.[1]);
    if(endpoint==='tile-search-results'&&query?.startsWith('?')&&size>0){const url=new URL('/'+endpoint+'/'+decode(query),base);if(url.searchParams.get('optionsFacetsDD_country')==='CN')tiles={url:url.href,page_size:size};}
  }
  return {rows,total,next:[...new Map(next.map(x=>[x.href,x.href])).values()],tiles};
}

/** Public list capability only. Never fetches individual job descriptions. */
export async function collectJobs2web(source,options={}){
  if(source.provider!=='jobs2web_public')return null;
  const client=options.client||createClient(options),origin=new URL(source.api_config?.origin||source.primary_entry_url).origin;
  const initial=new URL('/search/',origin);initial.searchParams.set('optionsFacetsDD_country','CN');
  let next=initial.href,total=null,complete=false,reason='page_limit_reached',tiles=null;
  const jobs=new Map(),seen=new Set(),pages=[],errors=[],excluded=[];
  try{for(let page=0;next&&page<(options.maxPages??1000);page++){
    if(seen.has(next))throw Error('repeated_page_url');seen.add(next);
    const response=await client.request({url:next},{purpose:'job_list'});
    if(response.record.http_status!==200)throw Error('Jobs2Web HTTP '+response.record.http_status);
    if(new URL(response.url||next).origin!==origin)throw Error('Jobs2Web redirected to different origin');
    const parsed=parseJobs2webList(response.text,next,{fragmentTotal:tiles?total:null});
    if(parsed.tiles)tiles=parsed.tiles;
    if(total!==null&&total!==parsed.total)errors.push('server_total_changed');total=parsed.total;
    const before=jobs.size;
    for(const row of parsed.rows){
      if(jobs.has(row.id)){errors.push('duplicate_job_ids');continue;}
      const cn=row.locations.some(x=>/(?:^|[,\s])CN(?:[,\s]|$)|\bChina\b|中国/.test(x))&&!row.locations.some(x=>/hong\s*kong|macau|macao|taiwan|taipei|香港|澳门|澳門|台湾|臺灣/i.test(x));
      if(!cn)excluded.push(row.id);
      const loc=normalizeJobLocations({locations_raw:row.locations,title:row.title});
      jobs.set(row.id,{job_id:row.id,company_id:source.company_id,company_name:source.display_name,title:row.title,official_url:row.url,job_url_kind:'official_detail',locations_raw:row.locations,cities:loc.cities,location_unknown:loc.unknown,location_special:loc.special,description:null,requirements:null,body_complete:false,formal_status:'unknown',open_status:'open',raw_file:response.record.response_file,detail_skipped_reason:'public_list_capability_only',recruitment_evidence:{provider:'jobs2web_public',country_filter:'CN',returned_location_confirms_mainland:cn},_mainland:cn});
    }
    pages.push({url:next,returned:parsed.rows.length,server_total:total,response_file:response.record.response_file,job_ids:parsed.rows.map(x=>x.id)});
    if(jobs.size===total){complete=!errors.length;reason='unique_ids_reconcile_server_total';break;}
    if(jobs.size===before||jobs.size>total)throw Error('empty_or_repeated_page_before_total');
    const offset=Number(new URL(next).searchParams.get('startrow')||0);
    next=parsed.next.filter(x=>Number(new URL(x).searchParams.get('startrow'))>offset).sort((a,b)=>Number(new URL(a).searchParams.get('startrow'))-Number(new URL(b).searchParams.get('startrow')))[0];
    if(!next&&tiles){const u=new URL(tiles.url);u.searchParams.set('startrow',String(offset+tiles.page_size));next=u.href;}
    if(next&&new URL(next).searchParams.get('optionsFacetsDD_country')!=='CN')throw Error('pagination_lost_country_filter');
    if(!next)reason='pagination_missing_before_total';
  }}catch(e){errors.push(e.message);reason=e.message;}
  const kept=[...jobs.values()].filter(x=>x._mainland).map(({_mainland,...x})=>x);
  if(excluded.length)errors.push('country_filter_returned_unconfirmed_rows');
  const listComplete=complete&&!errors.length,status=listComplete&&(options.mode==='list'||kept.length===0)?'complete':pages.length?'partial':'failed';
  return {company_id:source.company_id,display_name:source.display_name,checked_at:new Date().toISOString(),jobs:kept,requests:client.records,coverage:{status,collection_complete:status==='complete',list_complete:listComplete,server_total:total,pages:pages.length,jobs_observed:kept.length,scope:'Mainland China public listing; job bodies and recruitment direction unverified',capability:'public_list_only',reason:[reason,...errors,...(options.mode==='list'?[]:['job_details_not_collected'])].join('; '),page_evidence:pages,excluded_location_rows:excluded,incomplete_bodies:kept.length}};
}
