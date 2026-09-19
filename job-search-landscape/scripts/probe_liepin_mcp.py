"""Read-only anonymous MCP search acceptance; no application or resume tools."""
import argparse,datetime,json,pathlib,urllib.request

def main():
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);a=p.parse_args()
    out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
    if any(out.iterdir()):raise SystemExit('Refusing to overwrite evidence')
    url='https://open-agent.liepin.com/mcp/user';observations={}
    calls=[('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'read-only-source-validation','version':'1'}}),('tools/list',{}),('tools/call',{'name':'user-search-job','arguments':{'jobName':'产品经理','address':'上海','page':0}})]
    for method,params in calls:
        try:
            req=urllib.request.Request(url,data=json.dumps({'jsonrpc':'2.0','id':method,'method':method,'params':params}).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
            with urllib.request.urlopen(req,timeout=25) as f:
                body=f.read().decode();obs={'http_status':f.status,'body':body}
                try:obs['response']=json.loads(body)
                except ValueError:obs['parse_error']='Non-JSON response; not success'
        except Exception as e:obs={'error':str(e)}
        observations[method]=obs
    search=observations['tools/call'];r=search.get('response',{}).get('result',{});text=json.dumps(search)
    status='blocked_auth' if '401' in text or 'Unauthorized' in text else 'failed' if r.get('isError') or not r else 'requires_payload_review'
    result={'source':'liepin_mcp','tested_at':datetime.datetime.now().astimezone().isoformat(),'endpoint':url,'credential_configured':False,'status':status,'observations':observations}
    (out/'mcp-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(status)
    return 2
if __name__=='__main__':raise SystemExit(main())
