import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {verifyManifest,verifyPair,verifyFiles,verifyPortableText} from '../scripts/verify-package.mjs'

test('package validation refuses local dependencies and application binaries',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
 verifyManifest(manifest)
 for(const invalid of[{...manifest,bin:{chat:'dist/index.js'}},{...manifest,dependencies:{...manifest.dependencies,'dsh-im-kit':'^0.2.1'}},{...manifest,dependencies:{...manifest.dependencies,'dsh-im-requests':'^0.1.0'}},{...manifest,dependencies:{zod:'file:../private'}},{...manifest,dsh:{bundle:{}}}])assert.throws(()=>verifyManifest(invalid))
})
test('documentation and artifact checks refuse missing structure or private state',async()=>{
 const english=await readFile(new URL('../README.md',import.meta.url),'utf8'),chinese=await readFile(new URL('../README.zh.md',import.meta.url),'utf8')
 verifyPair(english,chinese)
 assert.throws(()=>verifyPair(english,chinese+'extra\n'))
 assert.throws(()=>verifyPair(english,chinese.replace('id="persistence"','id="different"')))
 assert.throws(()=>verifyFiles(['package.json','.credentials.yaml']))
 assert.throws(()=>verifyFiles(['package.json','dist/index.js']))
})
test('portable text checks reject synthetic credential and machine-path literals without echoing them',()=>{
 verifyPortableText('/** module */\nexport const value=1\n','public-source')
 for(const marker of['C:/Users/synthetic/private.txt','F:\\个人\\synthetic','sk-'+'x'.repeat(24),'value as unknown','double\n'])assert.throws(()=>verifyPortableText(marker+'\n','synthetic-fixture'),error=>!error.message.includes(marker))
})
