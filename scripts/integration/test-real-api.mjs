/** Use an explicitly supplied managed credential store read-only in a fresh native SDK profile. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,mkdir,readFile,writeFile,realpath,copyFile} from 'node:fs/promises'
import {join,basename} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {verifyInstalledArchive} from './verify-installed.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv
const argument=name=>{const index=args.indexOf(name);assert.ok(index>=0&&args[index+1],'Required '+name);return args[index+1]}
const library=await realpath(argument('--im-kit-archive')),credentialStore=await realpath(argument('--credential-store'))
const credentialHash=createHash('sha256').update(await readFile(credentialStore)).digest('hex')
await mkdir(join(root,'.test-artifacts','real-api'),{recursive:true})
const area=await mkdtemp(join(root,'.test-artifacts','real-api','run-')),home=join(area,'home'),profile='qq-chat-real-api',profileRoot=join(home,'profiles',profile)
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8')),dsh=join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js'),archives=[]
for(const source of[library,join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]){const path=join(area,basename(source));await copyFile(source,path);archives.push({path,name:basename(source),sha256:createHash('sha256').update(await readFile(path)).digest('hex')})}
await writeFile(join(area,'inputs.json'),JSON.stringify(archives.map(({name,sha256})=>({name,sha256})),null,2)+'\n')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD|DEEPSEEK_BASE_URL/i.test(key)))
await mkdir(join(area,'temp'),{recursive:true});Object.assign(env,{TEMP:join(area,'temp'),TMP:join(area,'temp')})
Object.assign(env,{DSH_HOME:home,DSH_SYSTEM_PROMPT:'Local synthetic acceptance conversation. No private persona or skills.'})
const setup=[]
async function run(argv,cwd){
 const timeout=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']})
 await writeFile(join(area,'setup-live.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()})+'\n')
 let stdoutBytes=0,stderrBytes=0,failure;child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length});child.stderr.on('data',chunk=>{stderrBytes+=chunk.length});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
 setup.push({code,signal,timedOut:timeout.aborted,stdoutBytes,stderrBytes});await writeFile(join(area,'installation.json'),JSON.stringify(setup,null,2)+'\n')
 if(failure)throw Error('REAL_API_SETUP_PROCESS_FAILED');assert.equal(code,0,'Isolated real-API profile setup failed');assert.equal(timeout.aborted,false)
}
await run([dsh,'--profile',profile,'--from-default-profile','sdk','--dump-config'],area)
const profileManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));profileManifest.pnpm={...profileManifest.pnpm,overrides:manifest.overrides}
await writeFile(join(profileRoot,'package.json'),JSON.stringify(profileManifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(root,'.test-artifacts','pnpm-store').replaceAll('\\','/')+'\ncache-dir='+join(root,'.test-artifacts','pnpm-cache').replaceAll('\\','/')+'\n')
let pnpm
find:for(const dir of(process.env.PATH??'').split(';'))for(const candidate of[join(dir,'pnpm.cjs'),join(dir,'node_modules','pnpm','bin','pnpm.cjs'),join(dir,'node_modules','corepack','dist','pnpm.js')]){try{await realpath(candidate);pnpm=candidate;break find}catch(error){if(error.code!=='ENOENT')throw error}}
assert.ok(pnpm,'pnpm is required')
await run([pnpm,'add',archives[0].path,'@deepseek-ai/dsh@0.2.2-rc.1',...Object.entries(manifest.peerDependencies).filter(([name])=>name!=='dsh-im-kit').map(([name,version])=>name+'@'+version),'--ignore-scripts'],profileRoot)
await run([dsh,'plugin','--profile',profile,'add',archives[1].path],area)
await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules','dsh-qq-chat'),join(area,'installed-files.json'))
const overlay=[
 {id:'credentials',config:{path:credentialStore,watch:false}},
 {id:'qq-chat-runtime',config:{enabled:true,namespace:'real-api-qa',presetId:'real-api-fixture',provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',maxTokens:256,modelTimeoutMs:45000}},
 {id:'session-telemetry-otel',disabled:true},
 {insert:[{id:'real-api-preset-registry',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'real-api-fixture'}},{id:'real-api-preset',name:'@deepseek-ai/dsh-agent-preset',config:{id:'real-api-fixture',plugins:[]}},{id:'real-api-probe',name:pathToFileURL(fileURLToPath(new URL('./real-api-probe.mjs',import.meta.url))).href,config:{resultPath:join(area,'result.json')}}]},
]
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
const child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdoutBytes=0,stderrBytes=0,exitCode,result
child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length});child.stderr.on('data',chunk=>{stderrBytes+=chunk.length})
const exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
try{
 const deadline=Date.now()+150000
 while(Date.now()<deadline){try{result=JSON.parse(await readFile(join(area,'result.json'),'utf8'));break}catch(error){if(error.code!=='ENOENT')throw error}assert.equal(exitCode,undefined,'Isolated real-API DSH exited early');await delay(50)}
 assert.ok(result,'Real-API smoke did not finish in its deadline')
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n')
 const stopped=await Promise.race([exit,delay(15000).then(()=>{throw Error('Real-API DSH shutdown timed out')})]);assert.equal(stopped.code,0)
 console.log(JSON.stringify({area,passed:result.passed,reason:result.reason??null,checks:result.checks,realQqMessagesSent:0}))
 assert.equal(result.passed,true,'Real API did not pass; see sanitized result metadata')
}finally{
 if(exitCode===undefined){child.stdin.end();const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}
 const unchanged=credentialHash===createHash('sha256').update(await readFile(credentialStore)).digest('hex')
 await writeFile(join(area,'process.json'),JSON.stringify({exitCode,stdoutBytes,stderrBytes,rawProcessOutputPersisted:false,nativeSessionPersistenceEnabled:true,credentialStoreUnchanged:unchanged,realQqMessagesSent:0},null,2)+'\n')
 assert.equal(unchanged,true,'Original managed credentials changed during the read-only test')
}
