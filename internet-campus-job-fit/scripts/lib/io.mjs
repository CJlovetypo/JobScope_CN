import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const SKILL_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export async function readJson(p,fallback) {try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}}
export async function writeJson(p,value) {await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n','utf8');await fs.rename(tmp,p);}
export function workspacePath(p) {const full=path.resolve(p);const rel=path.relative(SKILL_ROOT,full);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('输出必须位于本 skill 文件夹内：'+full);return full;}
export async function mapLimit(items,limit,fn) {let next=0;const results=new Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;results[i]=await fn(items[i],i);}}));return results;}
export function stamp() {return new Date().toISOString().replace(/[:.]/g,'-');}
export function relative(p) {return path.relative(SKILL_ROOT,p).split(path.sep).join('/');}
