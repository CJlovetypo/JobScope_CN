import json
from lark_client import call,OUT
sp=OUT/'feishu_state.json';s=json.loads(sp.read_text(encoding='utf-8'))
b=s['created']['data']['base']['base_token']
quick=['项目','类别','GitHub Stars','阅读优先级','一句话定义 What','使用流程速览','交付物速览','产品设计','能力实现','源码证据','主要限制','GitHub']
configs={
'00 阅读指南':[('阅读指南',['主题','内容','阅读建议'],None,None,None)],
'01 项目总览':[
 ('快速浏览',quick,None,None,None),
 ('Star 数排序',['项目','GitHub Stars','Star 查询时间','类别','一句话定义 What','主要限制','产品设计','能力实现','GitHub'],[{'field':'GitHub Stars','desc':True}],None,None),
 ('按求职环节分组',quick,[{'field':'GitHub Stars','desc':True}],[{'field':'类别','desc':False}],None),
 ('优先研究',quick,None,None,{'logic':'and','conditions':[['阅读优先级','intersects',['优先研究']]]}),
 ('谨慎参考与开源边界',quick,None,None,{'logic':'and','conditions':[['阅读优先级','intersects',['谨慎参考','边界对照']]]}),
 ('全部字段与版本',None,None,None,None)],
'02 产品设计':[
 ('输入到交付',['项目','关联项目','GitHub Stars','用户输入','启动与使用成本','逐步使用流程','交付格式与设计'],None,None,None),
 ('交互与人工控制',['项目','关联项目','目标用户与场景','交互与体验设计','人工控制与确认'],None,None,None),
 ('全部产品维度',None,None,None,None)],
'03 能力实现':[
 ('技术实现',['项目','关联项目','GitHub Stars','技术栈','岗位与材料获取','处理链路 How','评分与模型','数据库与记忆'],None,None,None),
 ('方法与能力边界',['项目','关联项目','心智模型与知识方法','失败与恢复','限制与未验证项','可复用设计'],None,None,None),
 ('全部能力维度',None,None,None,None)],
'04 源码证据':[('固定版本证据',['证据','关联项目','文件路径','起始行','结束行','支撑结论','固定 Commit 源码链接','核验方式'],None,[{'field':'关联项目','desc':False}],None)],
'05 候选池与排除':[('全部候选（按 Star）',None,[{'field':'GitHub Stars','desc':True}],None,None),('未深审候选',None,[{'field':'GitHub Stars','desc':True}],None,{'logic':'and','conditions':[['研究状态','intersects',['候选；未深审']]]})],
'06 检索日志':[('检索过程',None,None,None,None)]}
for name,defs in configs.items():
    tid=s['tables'][name]['id'];kwargs={'base_token':b,'table_id':tid}
    views=call('+view-list',**kwargs)['data']['views']
    byname={v['name']:v for v in views}
    if '表格' in byname and defs[0][0] not in byname:
        v=byname['表格'];call('+view-rename',**kwargs,view_id=v['id'],name=defs[0][0]);byname[defs[0][0]]=v
    done=s['tables'][name].setdefault('configured_views',{})
    for vn,visible,sort,group,flt in defs:
        if vn in done:continue
        if vn not in byname:
            r=call('+view-create',**kwargs,json={'name':vn,'type':'grid'})
            byname[vn]=r['data']['views'][0]
        vid=byname[vn]['id'];vk={**kwargs,'view_id':vid}
        for opt,value in [('visible-fields',{'visible_fields':visible} if visible else None),('sort',{'sort_config':sort} if sort else None),('group',{'group_config':group} if group else None),('filter',flt)]:
            if value is None:continue
            call('+view-get-'+opt,**vk)
            call('+view-set-'+opt,**vk,json=value)
        done[vn]=vid
        sp.write_text(json.dumps(s,ensure_ascii=False,indent=2),encoding='utf-8')
        print(name,vn,vid,flush=True)
print('Views complete',flush=True)
