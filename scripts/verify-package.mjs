/** Check portable publication metadata, documentation and the deliberate artifact allowlist. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFile,readdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'yaml'

/** Reject application binaries, undeclared profile layers and private dependency locations. */
export function verifyManifest(manifest){
 assert.equal(manifest.name,'dsh-qq-chat');assert.equal(manifest.type,'module');assert.equal(manifest.license,'MIT')
 assert.ok(!manifest.bin,'Only DSH profiles launch applications')
 assert.equal(manifest.engines?.dsh,'0.2.2-rc.1');assert.equal(manifest.dsh?.bundle?.patch,'./cordis.patch.yml')
 assert.equal(manifest.peerDependencies?.['dsh-im-kit'],'0.2.0')
 assert.equal(manifest.peerDependencies?.['@deepseek-ai/cordis-plugin-loader'],'~1.1.0')
 assert.equal(manifest.exports?.['.']?.import,'./dist/index.js');assert.equal(manifest.exports?.['.']?.types,'./dist/index.d.ts')
 assert.equal(manifest.exports?.['./control']?.import,'./dist/control.js');assert.equal(manifest.exports?.['./client']?.default,'./dist/client.js')
 assert.equal(manifest.dsh?.client?.platform,'web')
 for(const section of ['dependencies','peerDependencies','devDependencies'])for(const [name,value]of Object.entries(manifest[section]??{}))assert.ok(!/^(?:file:|link:|workspace:|[a-z]:[\\/]|[\\/])/i.test(value),'Nonportable dependency '+name)
}

/** Require the paired package pages to retain structure, anchors and concise summaries. */
export function verifyPair(english,chinese){
 for(const text of [english,chinese]){
  assert.match(text,/^kind: "package-bundle"$/m);assert.match(text,/^description: ".+"$/m)
  assert.ok(text.endsWith('\n')&&!text.endsWith('\n\n'))
 }
 assert.equal(english.split('\n').length,chinese.split('\n').length)
 assert.ok(english.split('## Summary\n')[1].split('\n## ')[0].trim().split(/\s+/).length<=100)
 const anchors=text=>[...text.matchAll(/<a id="([^"]+)">/g)].map(match=>match[1])
 assert.deepEqual(anchors(english),anchors(chinese))
}

/** Refuse fixture files, local state, undeclared documents and executable application entries. */
export function verifyFiles(paths){
 const exact=['LICENSE','README.md','README.zh.md','README.i18n.yaml','package.json','cordis.patch.yml']
 for(const path of paths)assert.ok(exact.includes(path)||/^dist\/(?:client\/)?[a-z][a-z-]*\.(?:js|d\.ts)$/.test(path)||/^docs\/upgrade-guide\/v0\.1\.0\/journal-v2\/guide(?:\.md|\.zh\.md|\.i18n\.yaml)$/.test(path),'Unexpected published file '+path)
 for(const path of [...exact,'dist/index.js','dist/index.d.ts','dist/control.js','dist/control.d.ts','dist/client.js','dist/client/index.d.ts','dist/store-worker.js','docs/upgrade-guide/v0.1.0/journal-v2/guide.md','docs/upgrade-guide/v0.1.0/journal-v2/guide.zh.md','docs/upgrade-guide/v0.1.0/journal-v2/guide.i18n.yaml'])assert.ok(paths.includes(path),'Missing public file '+path)
}

/** Refuse private machine locations and credential literals without printing matched content. */
export function verifyPortableText(text,label){
 assert.ok(!/[c-f]:[\\/](?:users|个人|项目工作区)[\\/]/i.test(text),'Private machine path in '+label)
 assert.ok(!/\bsk-[a-z0-9]{20,}\b/i.test(text),'Credential-like literal in '+label)
 assert.ok(!/\bas unknown\b/.test(text),'Unknown assertion in '+label)
 assert.ok(text.endsWith('\n')&&!text.endsWith('\n\n'),'Trailing newline in '+label)
}

async function sources(directory){
 const result=[]
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=resolve(directory,entry.name)
  if(entry.isDirectory())result.push(...await sources(path));else if(/\.tsx?$/.test(entry.name))result.push(path)
 }
 return result
}

async function main(){
 const root=fileURLToPath(new URL('../',import.meta.url)),manifest=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'))
 verifyManifest(manifest)
 verifyPair(await readFile(resolve(root,'README.md'),'utf8'),await readFile(resolve(root,'README.zh.md'),'utf8'))
 const guide=await readFile(resolve(root,'docs/upgrade-guide/v0.1.0/journal-v2/guide.md'),'utf8'),zh=await readFile(resolve(root,'docs/upgrade-guide/v0.1.0/journal-v2/guide.zh.md'),'utf8')
 for(const text of[guide,zh])assert.match(text,/^kind: upgrade-guide$/m)
 assert.equal(guide.split('\n').length,zh.split('\n').length);assert.ok(guide.trim().split(/\s+/).length<=500)
 assert.deepEqual([...guide.matchAll(/^## (.+)$/gm)].map(match=>match[1]),['Change','Migration'])
 assert.deepEqual([...zh.matchAll(/^## (.+)$/gm)].map(match=>match[1]),['变更','迁移'])
 const patch=parse(await readFile(resolve(root,'cordis.patch.yml'),'utf8'))
 assert.deepEqual(patch,[{insert:[{id:'qq-chat-control',name:'dsh-qq-chat/control'},{id:'qq-chat-runtime',name:'dsh-qq-chat',config:{enabled:false}}]}])
 for(const path of await sources(resolve(root,'src'))){const text=await readFile(path,'utf8');verifyPortableText(text,path);assert.ok(text.startsWith('/**'),'Module documentation missing')}
 assert.match(await readFile(resolve(root,'dist/client.js'),'utf8'),/Copyright \(c\) 2025 Colin McDonnell/)
 assert.ok(process.env.npm_execpath,'Run through npm run check')
 const child=spawn(process.execPath,[process.env.npm_execpath,'pack','--dry-run','--ignore-scripts','--json'],{cwd:root,signal:AbortSignal.timeout(60000),windowsHide:true,stdio:['ignore','pipe','pipe']})
 let stdout='',stderr='',failure
 child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failure=error})
 const code=await new Promise(resolve=>child.once('close',resolve));if(failure)throw failure;assert.equal(code,0,stderr)
 const pack=JSON.parse(stdout);assert.equal(pack.length,1)
 const paths=pack[0].files.map(file=>file.path);verifyFiles(paths)
 for(const path of paths)verifyPortableText(await readFile(resolve(root,path),'utf8'),path)
 console.log(JSON.stringify({package:manifest.name,passed:true,packedFiles:paths.length,checks:['portable-manifest','paired-documents','disabled-bundle','source-and-artifact-hygiene','artifact-allowlist']}))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
