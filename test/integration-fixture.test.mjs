/** The native protocol fixture must not mistake appended context for a new user command. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixtureMarker} from '../scripts/integration/fixture-marker.mjs'
test('fixture uses the last marked user input while respecting newer tool results and appended context',()=>{
 const text=value=>({type:'text',text:value})
 assert.equal(fixtureMarker({messages:[{role:'user',content:[text('context'),text('NATIVE_TOOL_REQUEST ALLOWED'),text('appended context')]}]}),'NATIVE_TOOL_REQUEST')
 assert.equal(fixtureMarker({messages:[{role:'user',content:[text('NATIVE_PREVIEW_HOLD'),text('NATIVE_AFTER_CANCEL'),text('context')]}]}),'NATIVE_AFTER_CANCEL')
 assert.equal(fixtureMarker({messages:[{role:'user',content:[text('NATIVE_TOOL_REQUEST'),{type:'tool_result',content:[text('done')]},text('context')]}]}),undefined)
})
