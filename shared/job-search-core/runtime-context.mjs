import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

export const CORE_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const PACK_ROOT = path.resolve(CORE_ROOT, '../..');
export const MODE_ROOTS = Object.freeze({campus:'job-search/runtime/campus', internship:'job-search/runtime/internship', social:'job-search/runtime/social'});
let selected;

// A CLI process/worker owns one business context. Never switch a loaded runtime
// from one direction to another: module-level caches and output paths are scoped.
export function configureRuntime({skillRoot, mode} = {}) {
  const root = path.resolve(skillRoot || path.join(PACK_ROOT, MODE_ROOTS[mode] || ''));
  const inferred = Object.keys(MODE_ROOTS).find(key => path.resolve(PACK_ROOT, MODE_ROOTS[key]) === root);
  if (!inferred || (mode && mode !== inferred)) throw Error('Skill 路径与招聘方向不一致：'+root);
  const config = JSON.parse(readFileSync(path.join(root, 'assets/search-mode.json'), 'utf8'));
  if (config.mode !== inferred) throw Error('search-mode.json 与 Skill 招聘方向不一致');
  if (selected && (selected.skillRoot !== root || selected.mode !== inferred)) throw Error('同一运行进程不能切换招聘方向；请为另一个 skill 启动独立进程或 Worker');
  return selected ||= Object.freeze({skillRoot:root, mode:inferred});
}

export function runtimeContext() {
  if (selected) return selected;
  if (process.env.JOB_FIT_SKILL_ROOT) return configureRuntime({skillRoot:process.env.JOB_FIT_SKILL_ROOT});
  // Existing maintenance commands/tests live inside their owning skill.
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  for (const [mode, name] of Object.entries(MODE_ROOTS)) {
    const root = path.join(PACK_ROOT, name), relative = path.relative(root, entry);
    if (entry && relative && relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)) return configureRuntime({skillRoot:root, mode});
  }
  return configureRuntime({mode:'campus'});
}
