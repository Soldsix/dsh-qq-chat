/** Verify installed bytes against the exact supplied archive without extracting files. */
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,relative,isAbsolute} from 'node:path'
import {promisify} from 'node:util'
const run=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex')

/** Compare every packaged regular file to the isolated installation. */
export async function verifyInstalledArchive(archive,packageRoot,resultPath){
 const listed=await run('tar',['-tf',archive],{windowsHide:true,maxBuffer:1024*1024})
 const files=listed.stdout.trim().split(/\r?\n/).filter(path=>path&&!path.endsWith('/'))
 const checks=[]
 for(let index=0;index<files.length;index+=6){
  const settled=await Promise.allSettled(files.slice(index,index+6).map(async path=>{
   assert.ok(path.startsWith('package/')&&!path.split('/').includes('..'),'Unsafe package path')
   const target=resolve(packageRoot,path.slice('package/'.length)),owned=relative(packageRoot,target)
   assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Installed file escaped package')
   const expected=await run('tar',['-xOf',archive,path],{windowsHide:true,encoding:'buffer',maxBuffer:8*1024*1024})
   const actual=await readFile(target),sha256=hash(expected.stdout)
   assert.equal(hash(actual),sha256,'Installed file does not match the supplied archive: '+path)
   return{path:path.slice('package/'.length),sha256,bytes:actual.length}
  }))
  for(const result of settled){if(result.status!=='fulfilled')throw result.reason;checks.push(result.value)}
 }
 await writeFile(resultPath,JSON.stringify({archiveSha256:hash(await readFile(archive)),files:checks},null,2)+'\n')
 return checks.length
}
