import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import readline from 'node:readline';
import {dataset} from '../../../recruitment-link-repair/scripts/history.mjs';

const verify=process.argv.includes('--verify');
const inventoryOnly=process.argv.includes('--inventory-only');
const complete=process.argv.includes('--complete');
if(process.argv.slice(2).some(s=>!['--verify','--inventory-only','--complete'].includes(s))||[verify,inventoryOnly,complete].filter(Boolean).length>1)throw new Error('Use one of --verify, --inventory-only, --complete, or no option');
const manifest=path.join(dataset,'manifests/files.jsonl');
if(complete&&fs.existsSync(manifest)){
  if(fs.existsSync(manifest+'.tmp'))throw new Error('An interrupted seal exists; resume it first');
  fs.renameSync(manifest,manifest+'.tmp');
  const meta=path.join(dataset,'manifests/seal.json');
  if(fs.existsSync(meta))fs.renameSync(meta,path.join(dataset,`manifests/seal.previous.${Date.now()}.json`));
}
async function digest(file){
  const h=createHash('sha256');
  // Most archives are tiny HTTP responses: avoid per-chunk async overhead on Windows.
  if(fs.statSync(file).size<=8*1024*1024)h.update(await fs.promises.readFile(file));
  else for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024}))h.update(chunk);
  return h.digest('hex');
}
let files=0,bytes=0,failures=0,hashedFiles=0;
if(verify){
  for await(const line of readline.createInterface({input:fs.createReadStream(manifest),crlfDelay:Infinity})){
    const r=JSON.parse(line),file=path.resolve(dataset,r.file);
    if(!file.startsWith(dataset+path.sep))throw new Error('Manifest path escapes dataset');
    try{
      if(fs.statSync(file).size!==r.bytes)throw new Error('size changed');
      if(r.sha256){if(await digest(file)!==r.sha256)throw new Error('content changed');hashedFiles++;}
      else if(fs.statSync(file).mtime.toISOString()!==r.mtime)throw new Error('mtime changed; no historical hash');
    }
    catch(e){console.error(r.file,e.message);failures++;}
    files++;bytes+=r.bytes;
  }
}else{
  if(fs.existsSync(manifest))throw new Error('Manifest already exists; verify it instead of overwriting historical hashes.');
  fs.mkdirSync(path.dirname(manifest),{recursive:true});
  const prior=new Map();
  const firstSeen=new Map();
  for(const name of fs.readdirSync(path.dirname(manifest)).filter(n=>/^files\.partial\.\d+\.jsonl$/.test(n)).sort()){
    for(const line of fs.readFileSync(path.join(path.dirname(manifest),name),'utf8').split('\n').filter(Boolean)){
      const r=JSON.parse(line);if(!firstSeen.has(r.file))firstSeen.set(r.file,r);
    }
  }
  if(fs.existsSync(manifest+'.tmp')){
    for(const line of fs.readFileSync(manifest+'.tmp','utf8').split('\n').filter(Boolean)){
      const r=JSON.parse(line);prior.set(r.file,r);if(!firstSeen.has(r.file))firstSeen.set(r.file,r);
    }
    console.log(`Resuming ${prior.size} previously hashed files`);
    fs.renameSync(manifest+'.tmp',path.join(path.dirname(manifest),`files.partial.${Date.now()}.jsonl`));
  }
  const changes=[],started=new Date().toISOString();
  const fd=fs.openSync(manifest+'.tmp','wx');
  try{
    for(const root of ['collections','snapshots']){
      const base=path.join(dataset,root);
      const entries=fs.readdirSync(base,{recursive:true,withFileTypes:true}).filter(f=>f.isFile()).sort((a,b)=>path.join(a.parentPath,a.name).localeCompare(path.join(b.parentPath,b.name)));
      for(let i=0;i<entries.length;i+=32){
        const records=await Promise.all(entries.slice(i,i+32).map(async f=>{
        const file=path.join(f.parentPath,f.name),relative=path.relative(dataset,file).replaceAll('\\','/'),before=fs.statSync(file);
        if(prior.has(relative)){
          const r=prior.get(relative);
          prior.delete(relative);
          if((r.sha256||inventoryOnly)&&before.size===r.bytes&&before.mtime.toISOString()===r.mtime){
            return r;
          }
        }
        const sha256=inventoryOnly?null:await digest(file),after=fs.statSync(file);
        if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error(`Changed during seal: ${file}`);
        return {file:relative,bytes:before.size,sha256,mtime:before.mtime.toISOString()};
        }));
        for(const r of records){
          const original=firstSeen.get(r.file);
          if(original&&(original.bytes!==r.bytes||original.mtime!==r.mtime))changes.push({file:r.file,previous_sha256:original.sha256,current_sha256:r.sha256,previous_bytes:original.bytes,current_bytes:r.bytes});
          fs.writeSync(fd,JSON.stringify(r)+'\n');files++;bytes+=r.bytes;
          if(r.sha256)hashedFiles++;
          if(files%10000===0)console.log(`${files} files sealed`);
        }
      }
    }
  }finally{fs.closeSync(fd);}
  if(prior.size)throw new Error(`Previously hashed files disappeared: ${prior.size}`);
  fs.renameSync(manifest+'.tmp',manifest);
  fs.writeFileSync(path.join(dataset,'manifests/seal.json'),JSON.stringify({started_at:started,sealed_at:new Date().toISOString(),files,bytes,hashed_files:hashedFiles,hash_complete:hashedFiles===files,changes_during_organization:changes,manifest_sha256:await digest(manifest),scope:'Complete file inventory; sha256=null means metadata only. Snapshot and index hashes are independently recorded in index/summary.json. Collections may remain writable through legacy junctions. Not an atomic filesystem snapshot.'},null,2)+'\n');
}
console.log(JSON.stringify({operation:verify?'verify':inventoryOnly?'inventory':'seal',files,bytes,hashed_files:hashedFiles,metadata_only_files:files-hashedFiles,failures}));
if(failures)process.exitCode=1;
