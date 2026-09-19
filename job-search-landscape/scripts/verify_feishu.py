import json,sys
from datetime import datetime
from lark_client import call,OUT
s=json.loads((OUT/'feishu_state.json').read_text(encoding='utf-8'))
specs=json.loads((OUT/'table_specs.json').read_text(encoding='utf-8'))
b=s['created']['data']['base']['base_token']
checks=[];issues=[]
for t in specs:
    name=t['name'];tid=s['tables'][name]['id'];records={};offset=0
    if '--cached' in sys.argv:
        records=json.loads((OUT/('readback_'+name+'.json')).read_text(encoding='utf-8'))
    while '--cached' not in sys.argv:
        r=call('+record-list',base_token=b,table_id=tid,limit=200,offset=offset,format='json')['data']
        for row,rid in zip(r['data'],r['record_id_list']):
            d=dict(zip(r['fields'],row));d['_id']=rid
            records[d[t['fields'][0]['name']]]=d
        offset+=len(r['data'])
        if not r.get('has_more'):break
        assert r['data'],'Empty page has_more'
    if len(records)!=len(t['rows']):issues.append([name,'row_count',len(records),len(t['rows'])])
    for row in t['rows']:
        actual=records.get(row[0]);assert actual is not None,(name,row[0])
        for f,v in zip(t['fields'],row):
            a=actual.get(f['name'])
            if v is None or v=='':
                ok=a is None or a==[] or a==''
            elif f['type']=='link':
                refs=[v['project_ref']] if isinstance(v,dict) else [e['project_ref'] for e in v]
                ok=sorted(e['id'] for e in a)==sorted(s['project_records'][e] for e in refs)
            elif f['type']=='select':ok=a==v or a==[v]
            elif f['type']=='datetime':ok=datetime.fromisoformat(a).replace(tzinfo=None).strftime('%Y-%m-%d %H:%M:%S')==v
            elif f.get('style',{}).get('type')=='url':ok=a==v or a==f'[{v}]({v})'
            else:ok=a==v
            if not ok:issues.append([name,row[0],f['name'],str(a)[:200],str(v)[:200]])
    (OUT/('readback_'+name+'.json')).write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
    checks.append({'table':name,'expected_rows':len(t['rows']),'read_rows':len(records),'cells_compared':len(t['rows'])*len(t['fields'])})
    print('Verified',name,len(records),'rows',flush=True)
report={'checks':checks,'issues':issues,'total_records':sum(c['read_rows'] for c in checks),'total_cells_compared':sum(c['cells_compared'] for c in checks)}
(OUT/'feishu_verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
if issues:raise SystemExit(1)
