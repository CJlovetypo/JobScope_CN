# 本地招聘链接历史库

历史寻源资料位于仓库根目录 `datasets/recruitment-links/`，不随 GitHub 分发。原件放在 `collections`，冻结输入在 `snapshots`，检索视图在 `index`，校验清单在 `manifests`，维护候选目录在 `catalog`。

```sh
node recruitment-link-repair/scripts/history.mjs --query=公司名 --limit=20
node recruitment-link-repair/scripts/history.mjs --host=app.mokahr.com --limit=20
node recruitment-link-repair/scripts/dataset/build.mjs --snapshot=2026-09-22
node recruitment-link-repair/scripts/dataset/seal.mjs --verify
```

检索返回总数、返回数、截断状态和证据指针。`evidence.file` 相对于数据集根目录；`location` 是 JSON Pointer 或 CSV 数据记录号。历史记录仅是修复线索，采用新接口配置前仍需验证主体和 API。新机器恢复私人历史库后才能检索这些原件；缺少它不影响正常求职、雷达以及项目自带的正式公司标签。
