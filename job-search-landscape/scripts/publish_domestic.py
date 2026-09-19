import json,pathlib
import lark_client
R=pathlib.Path(__file__).resolve().parents[1];O=R/'artifacts/2026-09-19-domestic'
lark_client.OUT=O
call=lark_client.call
base=json.loads((R/'artifacts/2026-09-17/feishu_state.json').read_text(encoding='utf-8'))['created']['data']['base']['base_token']
path=O/'feishu_state.json';s=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'base_token':base,'tables':{}}
specs=json.loads((O/'table_specs.json').read_text(encoding='utf-8'))
def save():path.write_text(json.dumps(s,ensure_ascii=False,indent=2),encoding='utf-8')
if not s.get('initial_inventory'):
    s['initial_inventory']=call('+table-list',base_token=base);save()
for t in specs:
    name=t['name']
    if name not in s['tables']:
        r=call('+table-create',base_token=base,name=name,fields=t['fields']);d=r['data'];table=d.get('table',d);tid=table.get('id') or table.get('table_id');assert tid,r
        s['tables'][name]={'id':tid,'created':r};save()
    ts=s['tables'][name];kw={'base_token':base,'table_id':ts['id']}
    if not ts.get('schema_verified'):
        r=call('+field-list',**kw);fs={f['name']:f['type'] for f in r['data']['fields']};assert all(fs.get(f['name'])==f['type'] for f in t['fields'])
        ts['schema_verified']=True;save()
    if not ts.get('written'):
        r=call('+record-batch-create',**kw,json={'fields':[f['name'] for f in t['fields']],'rows':t['rows']})
        ts['write_response']=r;save();assert len(r['data']['record_id_list'])==len(t['rows'])
        ts['written']=len(t['rows']);save()
    if not ts.get('verified'):
        r=call('+record-list',**kw,limit=200,format='json')['data'];actual={row[0]:dict(zip(r['fields'],row)) for row in r['data']};assert len(actual)==len(t['rows'])
        for row in t['rows']:
            a=actual[row[0]]
            for f,v in zip(t['fields'],row):
                av=a[f['name']];assert av==v or (v in ('',None) and av in ('',None,[])),(name,row[0],f['name'],av,v)
        (O/('readback_'+name+'.json')).write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8')
        ts['verified']=True;save()
    if not ts.get('view'):
        views=call('+view-list',**kw)['data']['views'];v=views[0];vid=v['id'];vk={**kw,'view_id':vid}
        vn='渠道与核验程度' if name.startswith('07') else '按Star查看' if name.startswith('08') else '真实数据与演示分开' if name.startswith('09') else '固定版本证据'
        call('+view-rename',**vk,name=vn)
        if name.startswith('08'):
            call('+view-get-sort',**vk);call('+view-set-sort',**vk,json={'sort_config':[{'field':'GitHub Stars','desc':True}]})
            call('+view-get-visible-fields',**vk);call('+view-set-visible-fields',**vk,json={'visible_fields':['项目','GitHub Stars','形态','来源覆盖','技术实现','交付物','完整性','限制','研究建议','源码证据']})
        ts['view']={'name':vn,'id':vid};save()
    print('Verified',name,ts['written'],'rows',flush=True)
s['verified_records']=sum(t['written'] for t in s['tables'].values());save()
print('Complete',s['verified_records'],flush=True)
