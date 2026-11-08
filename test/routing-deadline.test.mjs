import {test} from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {routingDeadline} from '../dist/routing-deadline.js'

test('routing deadline aborts the provider and releases the caller even if it does not settle',async()=>{
 let observed
 const keepAlive=delay(200)
 await assert.rejects(routingDeadline(new AbortController().signal,25,async signal=>{
  observed=signal
  return new Promise(()=>{})
 }),error=>error.name==='TimeoutError')
 assert.equal(observed.aborted,true)
 await keepAlive
})
test('caller cancellation is forwarded and completed decisions are returned',async()=>{
 const parent=new AbortController();let observed
 const pending=routingDeadline(parent.signal,1000,async signal=>{observed=signal;return new Promise(()=>{})})
 await Promise.resolve();parent.abort()
 await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(observed.aborted,true)
 assert.equal(await routingDeadline(new AbortController().signal,1000,async()=> 'reply'),'reply')
})
