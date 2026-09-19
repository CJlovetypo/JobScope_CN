/** Public configuration discovery only. A route is not proof of a target job.
 * Observed Moka schema: init-data.org.webSettings.nav.menus[] contains
 * {type:'site',siteId:150952,siteType:'social',siteVersion:2}; org.mobileSettings
 * can contain the same structure serialized as JSON. Never derive IDs by offset.
 */
export function mokaSiteCandidates(config,{entryUrl,orgId,mode='social',evidenceFile=null}={}) {
 const routes=[],notes=[];let origin;
 try {const u=new URL(entryUrl);if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw Error();origin=u.origin;}catch{return {routes,notes:['Invalid public bootstrap URL']};}
 const verifiedOrg=String(orgId??'');
 if(!verifiedOrg||String(config?.org?.id??'')!==verifiedOrg)return {routes,notes:['Public bootstrap organization does not match verified tenant']};
 const seen=new Set(),visited=new WeakSet();let count=0;
 const add=(url,configPath,basis)=>{
  let u;try{u=new URL(url,origin);if(!/^https?:$/.test(u.protocol)||u.username||u.password)return;}catch{return;}
  const match=u.pathname.match(/^\/(social-recruitment|campus-recruitment)\/([^/]+)\/([^/]+)\/?$/);if(!match)return;
  let tenant,siteId;try{tenant=decodeURIComponent(match[2]);siteId=decodeURIComponent(match[3]);}catch{return;}
  if(tenant!==verifiedOrg||!siteId||/[\s/\\?#]/.test(siteId))return;
  if(mode==='social'&&match[1]!=='social-recruitment')return;
  if(mode==='campus'&&match[1]!=='campus-recruitment')return;
  const entry=u.origin+u.pathname.replace(/\/$/,'');if(seen.has(entry))return;seen.add(entry);
  routes.push({entry,orgId:verifiedOrg,site:match[1],siteId,evidence_file:evidenceFile,config_path:configPath,discovery_basis:basis,requires_bootstrap_identity_check:true});
 };
 const visit=(value,configPath,depth=0)=>{
  if(depth>32||++count>20000)return;
  if(typeof value==='string'){
   const text=value.trim();
   // Public settings can be JSON strings; JSON.parse never executes page code.
   if(text.length<=2_000_000&&/^[\[{]/.test(text))try{visit(JSON.parse(text),configPath+':json',depth+1);}catch{/* Not a serialized configuration. */}
   if(text.length<4096&&!/\s/.test(text)&&/^(?:https?:\/\/|\/\/|\/(?:social|campus)-recruitment\/)/.test(text))add(text,configPath,'explicit_public_site_url');
   return;
  }
  if(!value||typeof value!=='object'||visited.has(value))return;visited.add(value);
  const nodeOrg=value.orgId??value.org_id;
  // An explicitly different nested tenant cannot inherit the outer identity.
  if(nodeOrg!=null&&String(nodeOrg)!==verifiedOrg)return;
  if(value.type==='site'&&value.siteId!=null&&['social','camp'].includes(value.siteType)){
   const version=value.siteVersion;if(version==null||Number(version)===2){
    const site=value.siteType==='social'?'social-recruitment':'campus-recruitment';
    add(`${origin}/${site}/${encodeURIComponent(verifiedOrg)}/${encodeURIComponent(String(value.siteId))}`,configPath,'explicit_public_site_tuple');
   }
  }
  for(const [key,child]of Object.entries(value))visit(child,configPath+'.'+key,depth+1);
 };
 visit(config,'config');return {routes,notes};
}

/** Re-fetch each candidate's public bootstrap before adopting its API route. */
export function confirmMokaSiteCandidate(candidate,config) {
 const reject=reason=>({accepted:false,reason});
 if(!config?.org)return reject('missing_target_public_configuration');
 if(String(config.org.id??'')!==String(candidate.orgId))return reject('target_tenant_mismatch');
 const ids=[config.siteId,config.org.siteId].filter(x=>x!=null);
 if(!ids.length||ids.some(x=>String(x)!==String(candidate.siteId)))return reject('target_site_id_mismatch');
 const types=[config.mode,config.org.type].filter(Boolean).map(x=>x==='campus'?'camp':x);
 const expected=candidate.site==='social-recruitment'?'social':'camp';
 if(!types.length||types.some(x=>x!==expected))return reject('target_site_type_mismatch');
 return {accepted:true,reason:'public_target_bootstrap_confirms_same_tenant_site_and_type'};
}
