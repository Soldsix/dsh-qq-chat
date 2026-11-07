import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {DatabaseSync} from 'node:sqlite'
import {setTimeout as delay} from 'node:timers/promises'
import {join} from 'node:path'
import {SqliteJournal} from '../dist/journal.js'
import {journal,message,receipt,mapping,area} from './helpers.mjs'

test('durable admission is atomic across concurrent duplicates and retains complete original text',async t=>{
 const {store,options}=await journal(t)
 const source=message('1',{text:'line one\nline two 中文'}),record=receipt(source)
 const outcomes=await Promise.all(Array.from({length:20},()=>store.claim(record)))
 assert.equal(outcomes.filter(value=>value==='created').length,1)
 assert.equal(outcomes.filter(value=>value==='duplicate').length,19)
 assert.deepEqual((await store.receipt(record.requestId)).input,source)
 assert.equal(await store.claim({...record,fingerprint:'b'.repeat(64)}),'conflict')
 await store.close()
 const reopened=await SqliteJournal.open(options);t.after(()=>reopened.close())
 const restored=await reopened.receipt(record.requestId)
 assert.equal(restored.phase,'interrupted');assert.deepEqual(restored.input,source)
 assert.equal(await reopened.claim(record),'duplicate')
})
test('model interval, send uncertainty and mapping survive reopen without changing the source',async t=>{
 const {store,options}=await journal(t),source=message('2'),record=receipt(source),map=mapping(source)
 await store.claim(record);await store.saveMapping(map);await store.start(record.requestId,map.sessionId)
 const result={requestId:record.requestId,status:'uncertain',reason:'delivery-uncertain',modelOutcome:'completed',modelReason:null,sessionId:map.sessionId,receipt:{status:'uncertain',code:'timeout'},reply:'synthetic result',fromOffset:2,toOffset:9}
 await store.finish(result)
 await assert.rejects(store.finish(result),error=>error.code==='invalid-data')
 assert.deepEqual(await store.mapping(map.mappingId),map)
 const page=await store.list(10,0)
 assert.equal(page.length,1);assert.equal('input'in page[0],false);assert.equal('reply'in page[0],false)
 await store.close()
 const reopened=await SqliteJournal.open(options);t.after(()=>reopened.close())
 assert.deepEqual((await reopened.receipt(record.requestId)).result,result)
 assert.deepEqual(await reopened.stats(),{receipts:1,queued:0,running:0,interrupted:0,responded:0,uncertain:1,mappings:1})
})
test('a second live worker cannot interrupt an existing owner and clean disposal permits reopening',async t=>{
 const {store,options}=await journal(t),r=receipt(message('3'))
 await store.claim(r)
 await assert.rejects(SqliteJournal.open(options),error=>error.code==='already-owned')
 assert.equal((await store.receipt(r.requestId)).phase,'queued')
 await store.close();await store.close()
 await assert.rejects(store.stats(),error=>['closed','worker-exited'].includes(error.code))
 const reopened=await SqliteJournal.open(options);await reopened.close()
})
test('foreign or newer database formats are refused without replacing their data',async()=>{
 for(const variant of ['foreign','future']){
  const directory=await area(),path=join(directory,'chat.sqlite3'),db=new DatabaseSync(path)
  if(variant==='foreign')db.exec('CREATE TABLE owner_data(value TEXT); INSERT INTO owner_data VALUES(\'preserve-me\')')
  else db.exec('PRAGMA application_id=1146307400; PRAGMA user_version=999')
  db.close()
  const before=await readFile(path)
  await assert.rejects(SqliteJournal.open({databasePath:path,busyMs:20,timeoutMs:1000,startupMs:3000,shutdownMs:1000}),error=>error.code==='schema-unsupported')
  assert.deepEqual(await readFile(path),before)
 }
})
test('corrupt retained source fails at the file boundary without echoing it in errors',async t=>{
 const {store,options}=await journal(t),r=receipt(message('4'))
 await store.claim(r)
 const db=new DatabaseSync(options.databasePath)
 db.prepare('UPDATE receipts SET input_json=? WHERE request_key=?').run('{"private":"synthetic-secret-marker"}',r.requestId);db.close()
 await assert.rejects(store.receipt(r.requestId),error=>error.code==='invalid-data'&&!error.message.includes('synthetic-secret-marker'))
})
test('sending intent remains available as uncertain after reopening and is not re-admitted',async t=>{
 const {store,options}=await journal(t),source=message('send-intent'),record=receipt(source),map=mapping(source)
 await store.claim(record);await store.start(record.requestId,map.sessionId)
 const result={requestId:record.requestId,status:'uncertain',reason:'delivery-uncertain',modelOutcome:'completed',modelReason:null,sessionId:map.sessionId,receipt:null,reply:'retained original output',fromOffset:1,toOffset:8}
 await store.prepareSend(result)
 assert.equal((await store.receipt(record.requestId)).phase,'sending')
 await store.close();const reopened=await SqliteJournal.open(options);t.after(()=>reopened.close())
 const restored=await reopened.receipt(record.requestId)
 assert.equal(restored.phase,'interrupted');assert.deepEqual(restored.result,result);assert.equal(await reopened.claim(record),'duplicate')
})
test('SQLite lock waits happen in the worker while the Host event loop keeps running',async t=>{
 const directory=await area(),options={databasePath:join(directory,'chat.sqlite3'),busyMs:1000,timeoutMs:3000,startupMs:5000,shutdownMs:3000}
 const store=await SqliteJournal.open(options);t.after(()=>store.close())
 const blocker=new DatabaseSync(options.databasePath);blocker.exec('BEGIN IMMEDIATE')
 let settled=false,tick=false
 const pending=store.claim(receipt(message('worker-lock'))).finally(()=>{settled=true})
 await delay(30);tick=true;assert.equal(settled,false)
 blocker.exec('COMMIT');blocker.close()
 assert.equal(await pending,'created');assert.equal(tick,true)
})
test('version 1 migration preserves raw source bytes and reports formerly unrecorded model outcome as unknown',async t=>{
 const directory=await area(),path=join(directory,'chat.sqlite3'),source=message('legacy'),r=receipt(source),map=mapping(source)
 const legacyMap={...map};delete legacyMap.lastDelivery
 const legacyResult={requestId:r.requestId,status:'uncertain',reason:'delivery-uncertain',sessionId:map.sessionId,receipt:{status:'uncertain',code:'timeout'},reply:'legacy answer',fromOffset:2,toOffset:9}
 const rawInput=JSON.stringify(source),db=new DatabaseSync(path)
 db.exec(`CREATE TABLE runtime_owner(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,pid INTEGER NOT NULL);
 CREATE TABLE receipts(request_key TEXT PRIMARY KEY,scope_key TEXT NOT NULL,fingerprint TEXT NOT NULL,mode TEXT NOT NULL,phase TEXT NOT NULL,input_json TEXT NOT NULL,result_json TEXT,session_id TEXT,updated_at INTEGER NOT NULL,outcome TEXT);
 CREATE INDEX receipt_phase ON receipts(phase); CREATE INDEX receipt_scope ON receipts(scope_key,updated_at);
 CREATE TABLE mappings(mapping_key TEXT PRIMARY KEY,payload_json TEXT NOT NULL);PRAGMA application_id=1146307400;PRAGMA user_version=1;`)
 db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(r.requestId,r.scopeKey,r.fingerprint,r.mode,'settled',rawInput,JSON.stringify(legacyResult),map.sessionId,Date.now(),'uncertain')
 db.prepare('INSERT INTO mappings VALUES(?,?)').run(map.mappingId,JSON.stringify(legacyMap));db.close()
 const store=await SqliteJournal.open({databasePath:path,busyMs:20,timeoutMs:3000,startupMs:5000,shutdownMs:3000});t.after(()=>store.close())
 const restored=await store.receipt(r.requestId);assert.deepEqual(restored.input,source);assert.equal(restored.result.modelOutcome,'unknown');assert.equal(restored.result.reply,'legacy answer')
 assert.equal((await store.mapping(map.mappingId)).lastDelivery,null)
 const inspection=new DatabaseSync(path);assert.equal(inspection.prepare('PRAGMA user_version').get().user_version,2)
 assert.equal(inspection.prepare('SELECT input_json FROM receipts').get().input_json,rawInput);inspection.close()
})
