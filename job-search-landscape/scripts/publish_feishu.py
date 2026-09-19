import json
from copy import deepcopy
from lark_client import call,OUT
statepath=OUT/'feishu_state.json'
state=json.loads(statepath.read_text(encoding='utf-8'))
tables=json.loads((OUT/'table_specs.json').read_text(encoding='utf-8'))
token=state['created']['data']['base']['base_token']
def save():statepath.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
state['tables'].setdefault('00 阅读指南',{'id':state['created']['data']['table']['id'],'created':state['created']['data']['table']})
save()
for t in tables:
    name=t['name']
    if name not in state['tables']:
        fields=deepcopy(t['fields'])
        for f in fields:
            if f.get('link_table')=='__OVERVIEW__':f['link_table']=state['tables']['01 项目总览']['id']
        r=call('+table-create',base_token=token,name=name,fields=fields)
        d=r['data'];table=d.get('table',d)
        tid=table.get('id') or table.get('table_id')
        if not tid:raise RuntimeError('Inspect create response before retry: '+json.dumps(r))
        state['tables'][name]={'id':tid,'created':r};save()
        print('Created',name,tid,flush=True)
    ts=state['tables'][name];tid=ts['id']
    if 'schema_verified' not in ts:
        r=call('+field-list',base_token=token,table_id=tid)
        existing={f['name']:f for f in r['data']['fields']}
        for f in t['fields']:
            assert f['name'] in existing,(name,f['name'])
            assert existing[f['name']]['type']==f['type'],(name,f)
        ts['schema_verified']=r;save()
    fields=[f['name'] for f in t['fields']]
    rows=deepcopy(t['rows'])
    def resolve(v):
        if isinstance(v,dict) and 'project_ref' in v:return [{'id':state['project_records'][v['project_ref']]}]
        if isinstance(v,list) and v and isinstance(v[0],dict) and 'project_ref' in v[0]:return [{'id':state['project_records'][x['project_ref']]} for x in v]
        return v
    rows=[[resolve(v) for v in row] for row in rows]
    completed=ts.setdefault('batches',[])
    for i in range(0,len(rows),150):
        bi=i//150
        if bi<len(completed):continue
        r=call('+record-batch-create',base_token=token,table_id=tid,json={'fields':fields,'rows':rows[i:i+150]})
        # Save full response immediately so an uncertain schema can be inspected without repeating the mutation.
        completed.append({'offset':i,'count':len(rows[i:i+150]),'response':r});save()
        d=r['data'];ids=d.get('record_id_list')
        if ids is None:raise RuntimeError('Inspect batch response before proceeding: '+json.dumps(r)[:1500])
        assert len(ids)==len(rows[i:i+150])
        if name=='01 项目总览':
            state.setdefault('project_records',{}).update(dict(zip(t['keys'][i:i+150],ids)));save()
        print('Wrote',name,i+len(ids),'/',len(rows),flush=True)
    ts['rows_written']=sum(b['count'] for b in completed);save()
print('Published',state['created']['data']['base']['url'],flush=True)
