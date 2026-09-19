import json
from lark_client import call, OUT

s = json.loads((OUT / 'feishu_state.json').read_text(encoding='utf-8'))
specs = {t['name']: t for t in json.loads((OUT / 'table_specs.json').read_text(encoding='utf-8'))}
base = s['created']['data']['base']['base_token']
checks = []
for name, table in s['tables'].items():
    views = call('+view-list', base_token=base, table_id=table['id'])['data']['views']
    actual = {v['name']: v['id'] for v in views}
    assert all(actual.get(n) == v for n, v in table['configured_views'].items()), name
    checks.append({'table': name, 'views': actual})
    print('Views verified:', name, len(actual), flush=True)

def get_rows(name, view_name):
    table = s['tables'][name]
    result = []
    while True:
        data = call('+record-list', base_token=base, table_id=table['id'],
                    view_id=table['configured_views'][view_name],
                    limit=200, offset=len(result), format='json')['data']
        result.extend(dict(zip(data['fields'], r)) for r in data['data'])
        if not data.get('has_more'):
            return result
        assert data['data']

rows = get_rows('01 项目总览', 'Star 数排序')
stars = [r['GitHub Stars'] for r in rows]
assert len(rows) == 52 and stars == sorted(stars, reverse=True), stars
checks.append({'view': 'Star 数排序', 'rows': len(rows), 'descending': True})
rows = get_rows('01 项目总览', '优先研究')
spec = specs['01 项目总览']
priority_index = next(i for i, f in enumerate(spec['fields']) if f['name'] == '阅读优先级')
expected = sum(r[priority_index] == '优先研究' for r in spec['rows'])
assert len(rows) == expected
assert all(r['阅读优先级'] in ('优先研究', ['优先研究']) for r in rows)
checks.append({'view': '优先研究', 'rows': len(rows), 'filter_verified': True})

result = {'checks': checks, 'issues': []}
(OUT / 'feishu_view_verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False), flush=True)
