/** Install the matching Chromium shell inside the Web fixture's isolated cache. */
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join,resolve} from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url)),cache=resolve(process.env.PLAYWRIGHT_BROWSERS_PATH??join(root,'.test-artifacts','browsers'))
const signal=AbortSignal.timeout(300000),child=spawn(process.execPath,[join(root,'node_modules','playwright','cli.js'),'install','chromium','--only-shell',...process.argv.slice(2)],{cwd:root,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:cache},windowsHide:true,signal,stdio:'inherit'})
let failure;child.once('error',error=>{failure=error})
const [code]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
if(signal.aborted)throw Error('Browser installation timed out')
if(failure)throw failure
if(code!==0)process.exit(typeof code==='number'?code:1)
