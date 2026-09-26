import {setTimeout as sleep} from 'node:timers/promises';

const instructions = 'Search the web before answering. Prefer official company sites, regulators and original disclosures. Cite sources for factual claims. Distinguish the recruiting entity from its parent and brand. Say when evidence is insufficient. Never treat existing local labels, search snippets or your own answer as independently verified page bodies.';
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function buildAgentRequest({input, model, preset, previousResponseId, schema, maxOutputTokens=2048}={}) {
  if(!nonempty(input))throw Error('需要非空问题 input');
  if(model && preset)throw Error('model 与 preset 请选择一个');
  if(model!==undefined&&!nonempty(model)||preset!==undefined&&!nonempty(preset))throw Error('model/preset 不能为空');
  if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>32768)throw Error('max-output-tokens 必须为 1–32768');
  if(previousResponseId!==undefined&&!nonempty(previousResponseId))throw Error('previous-response-id 不能为空');
  if(schema && (!nonempty(schema.name)||!/^[A-Za-z0-9_\-]{1,64}$/.test(schema.name)||!schema.schema||typeof schema.schema!=='object'||Array.isArray(schema.schema)))throw Error('schema 文件需要 name 和 JSON Schema 对象 schema');
  return {input, ...(model?{model}:{preset:preset||'low'}), instructions,
    tools:[{type:'web_search'},{type:'fetch_url'}], max_steps:5, max_output_tokens:maxOutputTokens,
    ...(previousResponseId?{previous_response_id:previousResponseId}:{}),
    ...(schema?{response_format:{type:'json_schema',json_schema:schema}}:{})};
}

export function retryDelay(headers, attempt=0, now=Date.now()) {
  const raw=headers?.get?.('retry-after');
  if(raw!==null&&raw!==undefined&&raw.trim()!=='') {
    const seconds=Number(raw);
    if(Number.isFinite(seconds)&&seconds>=0)return Math.ceil(seconds*1000);
    const date=Date.parse(raw);if(Number.isFinite(date))return Math.max(0,date-now);
  }
  return Math.min(30000,1000*2**attempt)+Math.floor(Math.random()*250);
}

export function normalizeAgentResponse(response,httpStatus,{structured=false}={}) {
  if(response.error||response.status!=='completed')throw Error('Perplexity 回答未完成，未保存为成功结果');
  if(!nonempty(response.output_text))throw Error('Perplexity 返回空回答');
  const output=response.output||[];
  const searches=output.filter(item=>item.type==='search_results');
  const fetches=output.filter(item=>item.type==='fetch_url_results');
  const citations=output.filter(item=>item.type==='message').flatMap(item=>item.content||[])
    .filter(content=>content.type==='output_text').flatMap(content=>content.annotations||[])
    .filter(annotation=>annotation.type==='url_citation');
  let parsed;
  if(structured)try {parsed=JSON.parse(response.output_text);}catch{throw Error('结构化回答不是有效 JSON，未保存为成功结果');}
  return {schema_version:1,provider:'perplexity_agent',http_status:httpStatus,response_id:response.id,
    model:response.model,status:response.status,checked_at:new Date().toISOString(),output_text:response.output_text,
    ...(structured?{structured_output:parsed}:{}), citations,search_results:searches,fetch_url_results:fetches,
    grounding_observed:searches.some(item=>item.results?.length)||fetches.some(item=>item.contents?.length),
    usage:response.usage||null,review_state:'answer_requires_independent_review'};
}

export async function answerWithWeb(options, {fetch:fetchImpl,wait=sleep,maxRetries=2,timeout=120000}={}) {
  const request=buildAgentRequest(options);
  const apiKey=process.env.PERPLEXITY_API_KEY?.trim();
  if(!apiKey)throw Error('缺少 PERPLEXITY_API_KEY。请在 https://console.perplexity.ai 创建密钥并在自己的终端设置环境变量；不要粘贴到聊天中。');
  const {default:Perplexity}=await import('@perplexity-ai/perplexity_ai');
  // Pin the public API host; never forward credentials to an environment-supplied base URL.
  const client=new Perplexity({apiKey,baseURL:'https://api.perplexity.ai',maxRetries:0,timeout,logLevel:'off',...(fetchImpl?{fetch:fetchImpl}:{})});
  for(let attempt=0;;attempt++) {
    let result;
    try {result=await client.responses.create(request).withResponse();}
    catch(error) {
      const status=error.status;
      if(status===429) {
        const delay=retryDelay(error.headers,attempt);
        // Never shorten Retry-After. Long waits are handed to the caller for a later retry.
        if(attempt<maxRetries&&delay<=60000){await wait(delay);continue;}
        throw Object.assign(Error('Perplexity HTTP 429：请求受限，请按 retry_after_ms 稍后重试'),{status,retry_after_ms:delay});
      }
      // Do not expose SDK error bodies, request headers, credentials or stack causes.
      if(status===401)throw Object.assign(Error('Perplexity HTTP 401：密钥认证失败，请检查 API Console 中的密钥'),{status});
      throw Object.assign(Error(Number.isInteger(status)?`Perplexity HTTP ${status}：请求失败`:'Perplexity 网络连接或请求超时'),Number.isInteger(status)?{status}:{});
    }
    return normalizeAgentResponse(result.data,result.response.status,{structured:!!options.schema});
  }
}
