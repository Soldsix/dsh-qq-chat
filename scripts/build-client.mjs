/** Emit the native ModuleLoader client with shared DSH platform modules. */
import {build} from 'esbuild'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('../',import.meta.url))
const shared=['react','react/jsx-runtime','react-dom','@deepseek-ai/dsh-client-ui-primitives','@deepseek-ai/dsh-client-store']
const result=await build({absWorkingDir:root,entryPoints:['src/client/index.ts'],outfile:'dist/client.js',tsconfig:'tsconfig.client.json',jsx:'automatic',bundle:true,format:'cjs',platform:'browser',target:'es2022',write:false,metafile:true,external:shared,treeShaking:true,legalComments:'inline',plugins:[{name:'owned-style',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]client[\\/]style\.css$/},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}))}}]})
for(const input of Object.keys(result.metafile.inputs)){const path=relative(root,resolve(root,input));assert.ok(!path.startsWith('..')&&!isAbsolute(path),'Client borrowed an undeclared ancestor input: '+input)}
for(const output of Object.values(result.metafile.outputs))for(const dependency of output.imports)assert.ok(!dependency.external||shared.includes(dependency.path),'Unexpected browser import: '+dependency.path)
assert.ok(!result.outputFiles.some(file=>file.path.endsWith('.css')),'Styles must be owned by the client lifetime')
const javascript=result.outputFiles.find(file=>file.path.endsWith('.js'));assert.ok(javascript)
const license=await readFile(resolve(root,'node_modules/zod/LICENSE'),'utf8')
const wrapped=`/*! Bundled zod/mini: MIT License\n${license.replaceAll('*/','* /').trim()}\n*/\nwindow.__ModuleLoader__.load({id:"dsh-qq-chat",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${javascript.text}\nreturn module.exports;}});\n`
await mkdir(resolve(root,'.test-artifacts'),{recursive:true})
await writeFile(resolve(root,'.test-artifacts/client-build-meta.json'),JSON.stringify(result.metafile,null,2)+'\n')
await writeFile(resolve(root,'dist/client.js'),wrapped)
process.stdout.write(JSON.stringify({clientBytes:Buffer.byteLength(wrapped),inputFiles:Object.keys(result.metafile.inputs).length,sharedPlatform:shared})+'\n')
