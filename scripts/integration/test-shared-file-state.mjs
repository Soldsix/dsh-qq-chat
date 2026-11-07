/** Observe hard-link status changes on an owned public dependency without modifying its bytes. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,stat,realpath,mkdtemp,mkdir,link,unlink,writeFile} from 'node:fs/promises'
import {join,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url)),testRoot=join(root,'.test-artifacts'),args=process.argv,index=args.indexOf('--profile-root')
assert.ok(index>=0&&args[index+1],'Pass --profile-root for an owned isolated Web profile')
const profile=await realpath(args[index+1]),profileRelative=relative(testRoot,profile)
assert.ok(!profileRelative.startsWith('..')&&!isAbsolute(profileRelative),'Profile escaped owned test dependencies')
const target=await realpath(join(profile,'node_modules','@deepseek-ai','dsh-client-ui-session','lib','client.js'))
const owned=relative(testRoot,target);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Probe target escaped owned test dependencies')
const hash=async()=>createHash('sha256').update(await readFile(target)).digest('hex')
await mkdir(join(testRoot,'shared-file-state'),{recursive:true})
const area=await mkdtemp(join(testRoot,'shared-file-state','run-')),probe=join(area,'temporary-hard-link.js')
const before=await stat(target),beforeHash=await hash();let added,removed,linked=false
try{await link(target,probe);linked=true;added=await stat(target)}finally{if(linked){await unlink(probe);removed=await stat(target)}}
assert.equal(await hash(),beforeHash);assert.equal(before.mtimeMs,removed.mtimeMs);assert.equal(before.nlink,removed.nlink)
const metadata=value=>({ctimeMs:value.ctimeMs,mtimeMs:value.mtimeMs,nlink:value.nlink,size:value.size})
const result={passed:true,target:owned,bytesUnchanged:true,before:metadata(before),afterLink:metadata(added),afterUnlink:metadata(removed),ctimeChanged:before.ctimeMs!==removed.ctimeMs}
await writeFile(join(area,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({area,...result}))
