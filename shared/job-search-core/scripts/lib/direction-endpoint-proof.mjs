// A documented target query may be confirmed without a current JD.
// A guessed URL or HTTP 200 alone is not enough; this does not classify any job.
export function directionEndpointProof(source,mode,record,payload){
 const no={accepted:false,reason:'target_endpoint_not_confirmed'};
 if(!['internship','social'].includes(mode)||record?.http_status!==200||!payload||typeof payload!=='object')return no;
 let body=record.body||{};if(typeof body==='string')try{body=JSON.parse(body);}catch{body=Object.fromEntries(new URLSearchParams(body));}
 let url;try{url=new URL(record.url);}catch{return no;}
 const one=(value,wanted)=>Array.isArray(value)&&value.length===1&&String(value[0])===wanted;
 let rows,field,value,basis;
 if(source.provider==='beisen'&&/\/GetJobAdPageList(?:$|\/)/i.test(url.pathname)&&Number(payload.Code)===200&&Array.isArray(payload.Data)&&one(body.Category,mode==='social'?'1':'3')){
  rows=payload.Data;field='Category';value=body.Category;basis='北森已核实类型枚举：1=社招、3=实习；成功返回标准岗位列表。';
 }else if(source.provider==='hotjob'&&/\/listPosition\//.test(url.pathname)&&String(payload.state)==='200'&&Array.isArray(payload.data?.pageForm?.pageData)&&String(body.recruitType)===(mode==='social'?'2':'12')){
  rows=payload.data.pageForm.pageData;field='recruitType';value=body.recruitType;basis='Hotjob 官方枚举：2=社招、12=实习生招聘；成功返回标准岗位列表。';
 }else if(source.provider==='feishu'&&/\/search\/job\/posts$/.test(url.pathname)&&Number(payload.code??0)===0&&Array.isArray(payload.data?.job_post_list)&&one(body.recruitment_id_list,mode==='social'?'101':'202')){
  rows=payload.data.job_post_list;field='recruitment_id_list';value=body.recruitment_id_list;basis='飞书招聘已核实类型枚举：101=社招、202=实习；成功返回标准岗位列表。';
 }else if(source.provider==='moka'&&mode==='social'&&/\/website\/jobs\/v2$/.test(url.pathname)&&body.site==='social-recruitment'&&body.orgId&&body.siteId&&Array.isArray(payload.data?.jobs)){
  rows=payload.data.jobs;field='site';value={site:body.site,orgId:body.orgId,siteId:body.siteId};basis='Moka 对应租户及站点的社招检索，匿名初始化后成功返回标准岗位列表。';
 }else return no;
 return {accepted:true,reason:'documented_target_query_returned_job_list',mode,api_url:record.url,method:record.method,request_field:field,request_value:value,basis,observed_rows:rows.length,raw_file:record.decoded_response_file||record.response_file,checked_at:record.checked_at};
}
