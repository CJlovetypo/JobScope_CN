"""One read-only replay entrypoint; each run retains a new evidence directory."""
import argparse,datetime,pathlib,subprocess,sys,json
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE=ROOT/'artifacts/live-platform-validation-20260919'
def main():
    p=argparse.ArgumentParser();p.add_argument('--source',required=True,choices=['liepin','liepin_mcp','nowcoder','ncss','51job','zhilian','lagou','shixiseng']);p.add_argument('--query',default='产品经理');p.add_argument('--city',default='上海');a=p.parse_args()
    out=ROOT/'artifacts/platform-reruns'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')/a.source
    if a.source in ('liepin','liepin_mcp'):
        script=ROOT/'scripts'/('validate_liepin_live.py' if a.source=='liepin' else 'probe_liepin_mcp.py');args=['--out',str(out)]
        if a.source=='liepin':args+=['--query',a.query,'--city',a.city]
    elif a.source in ('nowcoder','ncss'):
        script=BASE/'campus/validate_campus.py';args=['--only',a.source,'--out',str(out)]
        print('Campus acceptance uses company discovery (牛客) / 软件工程师 (NCSS); city/query flags do not apply.',flush=True)
    elif a.source=='shixiseng':script=BASE/'shixiseng/probe.py';args=['--query',a.query,'--city',a.city,'--out',str(out)]
    else:script=BASE/'commercial/run.py';args=['--source',a.source,'--query',a.query,'--city',a.city,'--output',str(out)]
    print('Evidence:',out,flush=True)
    r=subprocess.run([sys.executable,str(script),*args],cwd=ROOT)
    out.mkdir(parents=True,exist_ok=True)
    (out/'runner.json').write_text(json.dumps({'source':a.source,'exit_code':r.returncode,'script':str(script),'arguments':args},ensure_ascii=False,indent=2),encoding='utf-8')
    return r.returncode
if __name__=='__main__':raise SystemExit(main())
