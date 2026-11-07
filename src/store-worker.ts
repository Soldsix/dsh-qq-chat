/** Synchronous SQLite stays in one private worker, outside the Host event loop. */
import {DatabaseSync,type SQLInputValue} from 'node:sqlite'
import {mkdirSync,lstatSync} from 'node:fs'
import {dirname} from 'node:path'
import {parentPort,workerData} from 'node:worker_threads'
import {z} from 'zod'
import {commandSchema,workerConfig,StoreError,type StoreCommand} from './store-protocol.ts'
import {inputSchema,resultSchema,receiptSchema,mappingSchema,statsSchema} from './record-schemas.ts'

const SCHEMA_VERSION=2
const APPLICATION_ID=0x44534348
const port=parentPort
if(!port)throw new Error('Chat journal worker requires a parent port')
let db:DatabaseSync|undefined,owned=false,closed=false
const settings=workerConfig.parse(workerData)
type Row=Record<string,SQLInputValue>
const text=(value:SQLInputValue|undefined):string=>z.string().parse(value)
const json=(value:SQLInputValue|undefined):unknown=>JSON.parse(text(value))

function alive(pid:number):boolean{
  try{process.kill(pid,0);return true}catch(error){
    if(error instanceof Error&&'code'in error){if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true}
    throw new StoreError('unavailable')
  }
}
function database():DatabaseSync{if(!db||closed)throw new StoreError('closed');return db}
function readReceipt(row:Row|undefined):unknown{
  if(!row)return null
  return receiptSchema.parse({requestId:row['request_key'],scopeKey:row['scope_key'],fingerprint:row['fingerprint'],mode:row['mode'],phase:row['phase'],input:inputSchema.parse(json(row['input_json'])),updatedAt:row['updated_at'],sessionId:row['session_id'],result:row['result_json']===null?null:resultSchema.parse(json(row['result_json']))})
}
function release():void{
  if(!db)return
  if(owned){db.prepare('DELETE FROM runtime_owner WHERE id=1 AND run_id=?').run(settings.runId);owned=false}
  db.close();db=undefined;closed=true
}
try{
  mkdirSync(dirname(settings.databasePath),{recursive:true,mode:0o700})
  try{if(lstatSync(settings.databasePath).isSymbolicLink())throw new StoreError('invalid-data')}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error}
  db=new DatabaseSync(settings.databasePath)
  const version=Number(db.prepare('PRAGMA user_version').get()?.['user_version'])
  const application=Number(db.prepare('PRAGMA application_id').get()?.['application_id'])
  if(version===0&&application===0){
    const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()
    if(existing)throw new StoreError('schema-unsupported')
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE runtime_owner(id INTEGER PRIMARY KEY CHECK(id=1),run_id TEXT NOT NULL,pid INTEGER NOT NULL);
      CREATE TABLE receipts(request_key TEXT PRIMARY KEY,scope_key TEXT NOT NULL,fingerprint TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('live','preview')),phase TEXT NOT NULL CHECK(phase IN ('queued','running','sending','settled','interrupted')),input_json TEXT NOT NULL,result_json TEXT,session_id TEXT,updated_at INTEGER NOT NULL,outcome TEXT);
      CREATE INDEX receipt_phase ON receipts(phase);
      CREATE INDEX receipt_scope ON receipts(scope_key,updated_at);
      CREATE TABLE mappings(mapping_key TEXT PRIMARY KEY,payload_json TEXT NOT NULL);
      PRAGMA user_version=${SCHEMA_VERSION}; PRAGMA application_id=${APPLICATION_ID}; COMMIT;`)
  }else if(![1,SCHEMA_VERSION].includes(version)||application!==APPLICATION_ID)throw new StoreError('schema-unsupported')
  db.exec('PRAGMA busy_timeout='+settings.busyMs)
  if(db.prepare('PRAGMA journal_mode=WAL').get()?.['journal_mode']!=='wal')throw new StoreError('unavailable')
  db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE')
  try{
    const owner=db.prepare('SELECT run_id,pid FROM runtime_owner WHERE id=1').get()
    if(owner&&alive(z.number().int().positive().parse(owner['pid'])))throw new StoreError('already-owned')
    if(version===1){
      db.exec(`ALTER TABLE receipts RENAME TO receipts_v1;
        DROP INDEX receipt_phase; DROP INDEX receipt_scope;
        CREATE TABLE receipts(request_key TEXT PRIMARY KEY,scope_key TEXT NOT NULL,fingerprint TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('live','preview')),phase TEXT NOT NULL CHECK(phase IN ('queued','running','sending','settled','interrupted')),input_json TEXT NOT NULL,result_json TEXT,session_id TEXT,updated_at INTEGER NOT NULL,outcome TEXT);
        INSERT INTO receipts SELECT * FROM receipts_v1; DROP TABLE receipts_v1;
        CREATE INDEX receipt_phase ON receipts(phase); CREATE INDEX receipt_scope ON receipts(scope_key,updated_at);`)
      for(const row of db.prepare('SELECT mapping_key,payload_json FROM mappings').all()){
        const legacy=z.record(z.string(),z.unknown()).parse(json(row['payload_json']))
        const next=mappingSchema.parse({...legacy,lastDelivery:null})
        db.prepare('UPDATE mappings SET payload_json=? WHERE mapping_key=?').run(JSON.stringify(next),text(row['mapping_key']))
      }
      for(const row of db.prepare('SELECT request_key,result_json FROM receipts WHERE result_json IS NOT NULL').all()){
        const legacy=z.record(z.string(),z.unknown()).parse(json(row['result_json']))
        const next=resultSchema.parse({...legacy,modelOutcome:'unknown',modelReason:null})
        db.prepare('UPDATE receipts SET result_json=? WHERE request_key=?').run(JSON.stringify(next),text(row['request_key']))
      }
      db.exec('PRAGMA user_version='+SCHEMA_VERSION)
    }
    db.prepare('INSERT OR REPLACE INTO runtime_owner(id,run_id,pid) VALUES(1,?,?)').run(settings.runId,process.pid)
    const recovered=Number(db.prepare("UPDATE receipts SET phase='interrupted',updated_at=? WHERE phase IN ('queued','running','sending')").run(Date.now()).changes)
    db.exec('COMMIT');owned=true
    port.postMessage({type:'ready',recovered})
  }catch(error){db.exec('ROLLBACK');throw error}
}catch(error){
  try{release()}catch(closeError){/* A failed startup may leave SQLite already closed. */}
  db=undefined;closed=true
  port.postMessage({type:'startup-error',code:error instanceof StoreError?error.code:'startup-failed'})
  port.close()
}

function execute(command:StoreCommand):unknown{
  const db=database()
  switch(command.method){
    case'claim':{
      const r=command.record
      const changed=Number(db.prepare('INSERT INTO receipts(request_key,scope_key,fingerprint,mode,phase,input_json,result_json,session_id,updated_at,outcome) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_key) DO NOTHING').run(r.requestId,r.scopeKey,r.fingerprint,r.mode,r.phase,JSON.stringify(r.input),r.result===null?null:JSON.stringify(r.result),r.sessionId,r.updatedAt,r.result?.status??null).changes)
      if(changed===1)return'created'
      const old=db.prepare('SELECT fingerprint FROM receipts WHERE request_key=?').get(r.requestId)
      return old?.['fingerprint']===r.fingerprint?'duplicate':'conflict'
    }
    case'receipt':return readReceipt(db.prepare('SELECT * FROM receipts WHERE request_key=?').get(command.key))
    case'start':{
      const changed=db.prepare("UPDATE receipts SET phase='running',session_id=?,updated_at=? WHERE request_key=? AND phase='queued'").run(command.sessionId,Date.now(),command.key)
      if(Number(changed.changes)!==1)throw new StoreError('invalid-data')
      return null
    }
    case'finish':{
      const r=command.result
      const changed=db.prepare("UPDATE receipts SET phase='settled',result_json=?,session_id=COALESCE(?,session_id),updated_at=?,outcome=? WHERE request_key=? AND phase IN ('queued','running','sending')").run(JSON.stringify(r),r.sessionId,Date.now(),r.status,r.requestId)
      if(Number(changed.changes)!==1)throw new StoreError('invalid-data')
      return null
    }
    case'prepare-send':{
      const r=command.result
      const changed=db.prepare("UPDATE receipts SET phase='sending',result_json=?,session_id=COALESCE(?,session_id),updated_at=?,outcome='uncertain' WHERE request_key=? AND phase IN ('queued','running')").run(JSON.stringify(r),r.sessionId,Date.now(),r.requestId)
      if(Number(changed.changes)!==1)throw new StoreError('invalid-data')
      return null
    }
    case'mapping':{
      const row=db.prepare('SELECT payload_json FROM mappings WHERE mapping_key=?').get(command.key)
      return row?mappingSchema.parse(json(row['payload_json'])):null
    }
    case'save-mapping':db.prepare('INSERT INTO mappings(mapping_key,payload_json) VALUES(?,?) ON CONFLICT(mapping_key) DO UPDATE SET payload_json=excluded.payload_json').run(command.record.mappingId,JSON.stringify(command.record));return null
    case'stats':return statsSchema.parse(db.prepare(`SELECT COUNT(*) AS receipts,
      COALESCE(SUM(phase='queued'),0) AS queued,COALESCE(SUM(phase IN ('running','sending')),0) AS running,
      COALESCE(SUM(phase='interrupted'),0) AS interrupted,COALESCE(SUM(outcome='responded'),0) AS responded,
      COALESCE(SUM(outcome='uncertain'),0) AS uncertain,(SELECT COUNT(*) FROM mappings) AS mappings FROM receipts`).get())
    case'list':return db.prepare('SELECT request_key AS requestId,scope_key AS scopeKey,mode,phase,updated_at AS updatedAt,session_id AS sessionId,outcome FROM receipts ORDER BY updated_at DESC,request_key LIMIT ? OFFSET ?').all(command.limit,command.offset)
    case'close':release();return null
    default:{const unreachable:never=command;throw new Error('Unknown journal operation: '+String(unreachable))}
  }
}
if(!closed)port.on('message',(input:unknown)=>{
  const parsed=commandSchema.safeParse(input)
  if(!parsed.success){try{release()}catch(error){/* A malformed channel is closed even if SQLite has already failed. */}port.postMessage({type:'fatal',code:'invalid-data'});port.close();return}
  const command=parsed.data
  try{const value=execute(command);port.postMessage({type:'result',id:command.id,ok:true,value});if(command.method==='close')port.close()}
  catch(error){port.postMessage({type:'failure',id:command.id,ok:false,code:error instanceof StoreError?error.code:error instanceof z.ZodError?'invalid-data':'unavailable'})}
})
