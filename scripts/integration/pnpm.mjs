/** Resolve the test suite's pinned pnpm entry rather than a machine-global executable. */
import {createRequire} from 'node:module'
import {readFile,realpath} from 'node:fs/promises'
import {dirname,join} from 'node:path'
/** Return the declared pnpm package's CLI script for the current Node executable. */
export async function pnpmScript(root){
 const require=createRequire(join(root,'package.json')),manifestPath=require.resolve('pnpm')
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
 return realpath(join(dirname(manifestPath),manifest.bin.pnpm))
}
