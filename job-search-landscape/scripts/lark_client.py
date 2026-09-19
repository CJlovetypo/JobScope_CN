"""Use the installed npm CLI entrypoint without a cmd.exe JSON quoting layer."""
import json, subprocess, shutil, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'2026-09-17'
LOG=ROOT/'logs'
LOG.mkdir(exist_ok=True)
CLI=Path(r'C:\Users\11793\AppData\Roaming\npm\node_modules\@larksuite\cli\scripts\run.js')

def call(command, **flags):
    args=[shutil.which('node'),str(CLI),'base',command,'--as','user']
    for k,v in flags.items():
        if v is None:continue
        if isinstance(v,(dict,list)):
            if k=='json':
                fp=OUT/('payload_'+str(time.time_ns())+'.json')
                fp.write_text(json.dumps(v,ensure_ascii=False),encoding='utf-8')
                v='@'+str(fp.relative_to(ROOT))
            else:v=json.dumps(v,ensure_ascii=False,separators=(',',':'))
        args.extend(['--'+k.replace('_','-'),str(v)])
    r=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=100)
    log=LOG/(str(time.time_ns())+'_'+command.replace('+','')+'.json')
    log.write_text(json.dumps({'command':command,'flags':flags,'exit_code':r.returncode,'stdout':r.stdout,'stderr':r.stderr},ensure_ascii=False,indent=2),encoding='utf-8')
    if r.returncode:raise RuntimeError(f'{command}: {r.stderr} {r.stdout}')
    try:data=json.loads(r.stdout)
    except ValueError:raise RuntimeError(f'Unparseable {command} response (saved {log}): {r.stdout[:500]}')
    if isinstance(data,dict) and data.get('code',0) not in (0,None):raise RuntimeError(str(data))
    return data

if __name__=='__main__':
    state=OUT/'feishu_state.json'
    if state.exists():print(state.read_text(encoding='utf-8'))
    else:
        result=call('+base-create',name='求职 Skill 与开源项目｜源码拆解・2026-09-17',table_name='00 阅读指南',fields=[{'type':'text','name':'主题'},{'type':'text','name':'内容'},{'type':'text','name':'阅读建议'}],time_zone='Asia/Shanghai')
        state.write_text(json.dumps({'created':result,'tables':{}},ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False))
