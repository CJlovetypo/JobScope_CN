import json,pathlib,urllib.request
O=pathlib.Path(__file__).resolve().parents[1]/'artifacts/live-platform-validation-20260919/liepin'
target='0274926D4547ECFDF80822735EDDF958'
js="""JSON.stringify({title:document.title,url:location.href,headings:Array.from(document.querySelectorAll('h1,h2,h3')).map(x=>x.innerText),buttons:Array.from(document.querySelectorAll('button')).map(x=>x.innerText),loginText:/登录|扫码/.test(document.body.innerText),hasAuthText:/授权|Token|token|凭证/.test(document.body.innerText),links:Array.from(document.querySelectorAll('a')).map(x=>({text:x.innerText,url:x.href})).filter(x=>x.text&&!/token|key|secret/i.test(x.url)).slice(0,30)})"""
r=urllib.request.urlopen(urllib.request.Request('http://localhost:3456/eval?target='+target,data=js.encode(),method='POST'),timeout=30).read().decode()
(O/'mcp-landing.json').write_text(r,encoding='utf-8');print(r)
