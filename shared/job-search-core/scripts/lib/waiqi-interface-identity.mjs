const norm=value=>String(value||'').normalize('NFKC').toLowerCase()
  .replace(/(?:有限责任公司|股份有限公司|有限公司|公司|集团|中国|china|limited|ltd|inc|corporation|corp|group|plc)/gi,'')
  .replace(/[^\p{L}\p{N}]+/gu,'');

export function interfaceMatchesUrl(row,value){
  try{
    const url=new URL(value),entry=new URL(row.entry_url),config=row.api_config||{};
    if(row.provider==='workday'){
      if(url.origin!==config.origin)return false;
      const parts=url.pathname.split('/').filter(Boolean),siteIndex=parts[0]?.toLowerCase()==='recruiting'?2:/^[a-z]{2}-[a-z]{2}$/i.test(parts[0]||'')?1:0;
      return parts[siteIndex]?.toLowerCase()===String(config.site||'').toLowerCase();
    }
    if(row.provider==='oracle_recruiting')return url.origin===config.origin&&new RegExp('/sites/'+String(config.site).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:/|$)','i').test(url.pathname);
    if(row.provider==='smartrecruiters')return /^(?:jobs|careers)\.smartrecruiters\.com$/.test(url.hostname)&&new RegExp('^/'+String(config.company_identifier).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:/|$)','i').test(url.pathname);
    if(row.provider==='greenhouse')return /greenhouse/.test(url.hostname)&&url.pathname.toLowerCase().includes('/'+String(config.board_token).toLowerCase());
    if(row.provider==='ashby')return url.hostname==='jobs.ashbyhq.com'&&decodeURIComponent(url.pathname.split('/').filter(Boolean)[0]||'').toLowerCase()===String(config.board_token||'').toLowerCase();
    if(row.provider==='moseeker_public')return url.hostname==='www.moseeker.com'&&url.pathname===`/positions/index/cid/${config.company_id}`;
    if(row.provider==='moka'){
      const route=url.pathname.match(/\/(?:m\/)?(campus-recruitment|social-recruitment|campus_apply|social_apply|apply)\/([^/]+)\/(\d+)/i);
      const expected=row.entry_url.match(/\/(?:m\/)?(campus-recruitment|social-recruitment|campus_apply|social_apply|apply)\/([^/]+)\/(\d+)/i);
      return Boolean(route&&expected)&&route[1].toLowerCase()===expected[1].toLowerCase()&&route[2].toLowerCase()===expected[2].toLowerCase()&&route[3]===expected[3];
    }
    if(row.provider==='hotjob'){
      const tenant=entry.pathname.match(/\/(SU[a-zA-Z0-9]+)/)?.[1];
      return Boolean(tenant)&&url.origin===entry.origin&&url.pathname.includes('/'+tenant+'/');
    }
    return url.origin===entry.origin;
  }catch{return false;}
}

export function companyNameMatches(company,value){
  const observed=norm(value);
  return Boolean(observed)&&[company.display_name,...company.aliases||[]].some(name=>{
    const expected=norm(name);
    return Boolean(expected)&&(expected===observed||expected.includes(observed)||observed.includes(expected));
  });
}
