/** Establish whether a packaging update changes anything beyond the paired README. */
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {readFile,writeFile,realpath} from 'node:fs/promises'
const run=promisify(execFile),args=process.argv,hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const argument=name=>{const index=args.indexOf(name);assert.ok(index>=0&&args[index+1],'Required '+name);return args[index+1]}
const before=await realpath(argument('--before')),after=await realpath(argument('--after')),output=argument('--output')
async function inspect(archive){
 const listed=await run('tar',['-tf',archive],{windowsHide:true,maxBuffer:1024*1024})
 const paths=listed.stdout.trim().split(/\r?\n/).filter(path=>path&&!path.endsWith('/')),files=new Map()
 for(let index=0;index<paths.length;index+=6){
  const settled=await Promise.allSettled(paths.slice(index,index+6).map(async path=>{
   assert.ok(path.startsWith('package/')&&!path.split('/').includes('..'),'Unsafe archive path')
   const data=await run('tar',['-xOf',archive,path],{windowsHide:true,encoding:'buffer',maxBuffer:8*1024*1024})
   return[path.slice(8),hash(data.stdout)]
  }))
  for(const result of settled){if(result.status!=='fulfilled')throw result.reason;files.set(...result.value)}
 }
 return files
}
const [oldFiles,newFiles]=await Promise.all([inspect(before),inspect(after)])
assert.deepEqual([...oldFiles.keys()].sort(),[...newFiles.keys()].sort(),'Archive file sets differ')
const changed=[...newFiles.keys()].filter(path=>oldFiles.get(path)!==newFiles.get(path))
assert.ok(changed.every(path=>['README.md','README.zh.md','README.i18n.yaml'].includes(path)),'Packaging update includes non-README changes')
const result={passed:true,beforeSha256:hash(await readFile(before)),afterSha256:hash(await readFile(after)),filesCompared:newFiles.size,changed,runtimeAndDeclarationsAndManifestAndBundleUnchanged:true}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
