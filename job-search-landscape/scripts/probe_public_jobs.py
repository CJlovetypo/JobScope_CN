import concurrent.futures,datetime,json,pathlib,urllib.request,urllib.parse
OUT=pathlib.Path(__file__).resolve().parents[1]/'artifacts/2026-09-19-domestic'
targets=[
 ('腾讯官网','https://careers.tencent.com/tencentcareer/api/post/Query?pageIndex=1&pageSize=2&language=zh-cn&area=cn',None,'https://careers.tencent.com/'),
 ('国家大学生就业平台','https://www.ncss.cn/student/jobs/jobslist/ajax/?offset=1&limit=2&jobType=&areaCode=&jobName=&sourcesName=0',None,'https://www.ncss.cn/student/jobs/index.html'),
 ('牛客企业岗位','https://nowpick.nowcoder.com/u/company/job/list/v2',{'recruitType':0,'page':1,'pageSize':2,'companyId':157},'https://www.nowcoder.com/'),
]
def probe(t):
    name,url,form,referer=t
    r={'name':name,'url':url,'form':form,'time':datetime.datetime.now().astimezone().isoformat(),'method':'POST' if form else 'GET','scope':'单次无登录公开读取；不重试、不批量采集'}
    try:
        req=urllib.request.Request(url,data=urllib.parse.urlencode(form).encode() if form else None,headers={'User-Agent':'Mozilla/5.0','Referer':referer,'Content-Type':'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req,timeout=18) as f:
            raw=f.read(1500000).decode('utf-8',errors='replace');r['http_status']=f.status;r['content_type']=f.headers.get('Content-Type');r['bytes']=len(raw)
        try:
            d=json.loads(raw);r['response_keys']=list(d) if isinstance(d,dict) else []
            data=d.get('Data',d.get('data',{}));r['data_keys']=list(data) if isinstance(data,dict) else []
            rows=data.get('Posts',data.get('list',data.get('datas',[]))) if isinstance(data,dict) else []
            r['rows_returned']=len(rows) if isinstance(rows,list) else None
            r['sample_public_job']={k:v for k,v in rows[0].items() if k in ['RecruitPostName','PostId','jobName','jobId','title','name','id','positionName']} if rows else None
            r['business_code']=d.get('Code',d.get('code'));r['message']=d.get('Message',d.get('msg',d.get('message')))
        except ValueError:r['non_json_excerpt']=raw[:180]
    except Exception as e:r['error']=str(e)
    return r
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as p:results=list(p.map(probe,targets))
(OUT/'public_endpoint_probes.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
