#!/usr/bin/env python3
"""Classify QR payloads recovered from WeChat recruitment posters."""
from __future__ import annotations

import argparse, csv, json
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

ATS={"mokahr.com":"moka","zhiye.com":"beisen","jobs.feishu.cn":"feishu","jobs.f.mioffice.cn":"feishu","hotjob.cn":"hotjob","51job.com":"51job","zhaopin.com":"zhaopin","nowcoder.com":"nowcoder","workdayjobs.com":"workday","myworkdayjobs.com":"workday","greenhouse.io":"greenhouse"}
NOISE={"weixin.qq.com","mp.weixin.qq.com","open.weixin.qq.com"}
WORDS=("job","jobs","career","careers","campus","recruit","zhaopin","hr","join","talent","position")

def classify(url):
    try: p=urlparse(url);host=(p.hostname or '').lower();low=url.lower()
    except: return 'invalid',''
    if host in NOISE or host.endswith('.weixin.qq.com'):return 'wechat_account_or_miniprogram',''
    for suffix,provider in ATS.items():
        if host==suffix or host.endswith('.'+suffix):return 'recognized_ats',provider
    if any(word in host or word in p.path.lower() for word in WORDS):return 'possible_recruitment',''
    return 'other',''

def main():
    ap=argparse.ArgumentParser();ap.add_argument('unique_links',type=Path);ap.add_argument('images',type=Path);ap.add_argument('output',type=Path);a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    with a.unique_links.open(encoding='utf-8-sig',newline='') as f:meta={r['url_normalized']:r for r in csv.DictReader(f)}
    occurrences=[]
    with a.images.open(encoding='utf-8') as f:
        for line in f:
            if not line.strip():continue
            item=json.loads(line)
            for value in item.get('qr_values') or []:
                if not value.lower().startswith(('http://','https://')):category,provider='non_url_payload',''
                else:category,provider=classify(value)
                for article in item.get('article_urls') or ['']:
                    source=meta.get(article,{})
                    occurrences.append({'article_url':article,'companies':source.get('companies',''),'documents':source.get('documents',''),'image_url':item.get('image_url',''),
                                        'qr_value':value,'qr_host':urlparse(value).hostname if value.lower().startswith(('http://','https://')) else '',
                                        'category':category,'provider_hint':provider,'evidence_file':item.get('evidence_file','')})
    cols=['article_url','companies','documents','image_url','qr_value','qr_host','category','provider_hint','evidence_file']
    with (a.output/'qr-link-occurrences.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=cols);w.writeheader();w.writerows(occurrences)
    grouped={}
    for row in occurrences:
        g=grouped.setdefault(row['qr_value'],{**row,'article_urls':set(),'companies_set':set(),'documents_set':set(),'images':set()})
        g['article_urls'].add(row['article_url']);g['companies_set'].update(x.strip() for x in row['companies'].split('|') if x.strip());g['documents_set'].update(x.strip() for x in row['documents'].split('|') if x.strip());g['images'].add(row['image_url'])
    unique=[];candidates=defaultdict(lambda:{'entry_urls':set(),'source_article_urls':set(),'documents':set(),'providers':set()})
    for value,g in grouped.items():
        row={k:g[k] for k in cols};row.update({'article_count':len(g['article_urls']),'image_count':len(g['images']),'companies':' | '.join(sorted(g['companies_set'])),'documents':' | '.join(sorted(g['documents_set']))});unique.append(row)
        if row['category'] in {'recognized_ats','possible_recruitment'}:
            for company in g['companies_set'] or {row['qr_host']}:
                c=candidates[company];c['entry_urls'].add(value);c['source_article_urls'].update(g['article_urls']);c['documents'].update(g['documents_set']);
                if row['provider_hint']:c['providers'].add(row['provider_hint'])
    ucols=['qr_value','qr_host','category','provider_hint','article_count','image_count','companies','documents','article_url','image_url','evidence_file']
    with (a.output/'qr-links-unique.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=ucols,extrasaction='ignore');w.writeheader();w.writerows(sorted(unique,key=lambda x:(x['category'],x['qr_host'],x['qr_value'])))
    cs=[{'display_name':name,'entry_urls':sorted(v['entry_urls']),'source_article_urls':sorted(v['source_article_urls']),'documents':sorted(v['documents']),'provider_hints':sorted(v['providers']),'source_origin':'wps_wechat_qr'} for name,v in sorted(candidates.items())]
    (a.output/'api-candidates.json').write_text(json.dumps(cs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    counts=Counter(x['category'] for x in unique);providers=Counter(x['provider_hint'] for x in unique if x['provider_hint'])
    summary={'qr_occurrences':len(occurrences),'unique_qr_values':len(unique),'category_counts':dict(counts),'provider_counts':dict(providers),'candidate_company_labels':len(cs),'candidate_links':sum(len(x['entry_urls']) for x in cs)}
    (a.output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary,ensure_ascii=False))

if __name__=='__main__':main()
