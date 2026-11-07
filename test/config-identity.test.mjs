import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Config,resolveConfig} from '../dist/config.js'
import {CONFIG_FIELDS} from '../dist/config-fields.js'
import {requestId,fingerprint,mappingId,sessionId} from '../dist/identity.js'
import {message,root} from './helpers.mjs'

test('disabled chat resolves before storage and enabled defaults remain within the selected profile',()=>{
 assert.equal(resolveConfig(Config({}),''),null)
 const config=Config({enabled:true}),spec=resolveConfig(config,root)
 assert.ok(spec.databasePath.startsWith(root));assert.ok(spec.workspacePath.startsWith(root))
 assert.deepEqual(Object.keys(CONFIG_FIELDS).sort(),Object.keys(config).sort())
 for(const change of [{namespace:'../other'},{provider:'fixture'},{databasePath:'relative/file'},{allowedTools:['a','a']},{maxPending:1,maxPendingPerScope:2},{storageBusyMs:100,storageTimeoutMs:100}])assert.throws(()=>resolveConfig(Config(change),root))
})
test('identity separates accounts, groups, private chat, previews and presets while replay time does not change content identity',()=>{
 const input=message('1'),later={...input,receivedAt:input.receivedAt+1000}
 assert.equal(requestId(input,'live'),requestId(later,'live'))
 assert.equal(fingerprint(input),fingerprint(later))
 assert.notEqual(fingerprint(input),fingerprint({...input,parts:[{type:'text',text:'changed'}]}))
 for(const other of [message('1',{account:'90000003'}),message('1',{peer:'90000200'}),message('1',{kind:'private'})])assert.notEqual(requestId(input,'live'),requestId(other,'live'))
 assert.notEqual(requestId(input,'live'),requestId(input,'preview'))
 assert.notEqual(mappingId('qa',input.scope,'live','a'),mappingId('qa',input.scope,'live','b'))
 assert.match(sessionId(mappingId('qa',input.scope,'live','a')),/^im-chat-[a-f0-9]{64}$/)
})
