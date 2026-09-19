# 求职项目源码调研

本目录独立保存本次调研产物，不修改被研究项目或其它 Skill。

- `artifacts/2026-09-17/report.md`：完整可读分析与固定 commit 证据链接。
- `artifacts/2026-09-17/analysis_full.json`：逐项目分析。
- 同目录 `00–06*.csv`：各飞书表的可导入备份。
- `source_manifest.json`：源码位置、SHA、GitHub Stars、查询时间、许可证和归档状态。
- `searches.json` / `candidates.json`：原始 GitHub 搜索记录。
- `table_specs.json` / `feishu_state.json`：发布数据和飞书回执。
- `sources/`：实际拉取的源码；仅做静态审查，未执行第三方项目。

运行 `scripts/build_deliverables.py` 会核验所有引用路径和行号，再重建本地交付。不要对已有飞书 Base 重复批量创建记录；发布脚本以本地状态记录已完成操作。
