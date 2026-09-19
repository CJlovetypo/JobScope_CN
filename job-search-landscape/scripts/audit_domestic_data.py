import collections,gzip,json,pathlib,hashlib
R=pathlib.Path(__file__).resolve().parents[1];out=R/'artifacts/2026-09-19-domestic'
base=R/'sources/zeitvex__JobResearchHub/data/main'
manifest=json.loads((base/'manifest.json').read_text(encoding='utf-8'))
counts=collections.Counter();sources=collections.Counter();keys=collections.Counter();dates=collections.Counter();ids=set();companies=set();hashes=[]
for p in sorted(base.glob('jobs-*.jsonl.gz')):
    expected=next(x['sha256'] for x in manifest['shards'] if x['path']==p.name)
    hashes.append({'file':p.name,'hash_matches':hashlib.sha256(p.read_bytes()).hexdigest()==expected})
    with gzip.open(p,'rt',encoding='utf-8') as f:
        for line in f:
            x=json.loads(line);counts['records']+=1;keys.update(x.keys())
            counts['nonempty_full_jd']+=bool(str(x.get('full_jd','')).strip())
            ids.add(str(x.get('record_id','')));companies.add(str(x.get('company_name','')))
            source=x.get('source',{})
            sources[source.get('platform','unknown')]+=1
            if source.get('collected_at'):dates['collected_at:'+str(source['collected_at'])[:10]]+=1
            for k in ['scraped_at','collected_at','published_at','publish_date']:
                if x.get(k):dates[k+':'+str(x[k])[:10]]+=1
            if counts['records']==1:sample=x
result={'JobResearchHub':{'counts':dict(counts),'unique_record_ids':len(ids),'company_field_distinct':len(companies),'source_counts':dict(sources),'keys':dict(keys),'dates':dict(dates),'hash_checks':hashes,'sample':sample}}
base=R/'sources/kknee-dev__recruit-hub/data'
checks=[]
for p in sorted(base.rglob('jobs-*.json')):
    x=json.loads(p.read_text(encoding='utf-8'));rows=x if isinstance(x,list) else x.get('jobs',x.get('data',[]))
    checks.append({'file':str(p.relative_to(base)),'type':type(x).__name__,'keys':list(x)[:16] if isinstance(x,dict) else [],'rows':len(rows),'metadata':{k:v for k,v in x.items() if not isinstance(v,(list,dict))} if isinstance(x,dict) else {},'sample':rows[0] if rows else None})
result['recruit-hub']=checks
(out/'data_audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'JobResearchHub':{k:v for k,v in result['JobResearchHub'].items() if k not in ['sample','dates','keys']},'recruit-hub':[{k:v for k,v in x.items() if k not in ['sample','metadata']} for x in checks]},ensure_ascii=False,indent=2))
