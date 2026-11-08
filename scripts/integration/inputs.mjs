/** Pinned public release inputs and explicit overrides for isolated integration tests. */
import {realpath,readFile,writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises'
import {resolve,join,basename} from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
/** Return an explicit test archive, or download the pinned public dependency for installation evidence. */
export async function imKitArchive(){
 const index=process.argv.indexOf('--im-kit-archive')
 const input=index<0?process.env.DSH_IM_KIT_ARCHIVE:process.argv[index+1]
 if(!input){
  const root=fileURLToPath(new URL('../../',import.meta.url)),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
  const url=manifest.dependencies['dsh-im-kit'],directory=join(root,'.test-artifacts','public-inputs')
  await mkdir(directory,{recursive:true});const area=await mkdtemp(join(directory,'kit-'))
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Public messaging-kit download failed: '+response.status)
  const data=Buffer.from(await response.arrayBuffer()),target=join(area,'dsh-im-kit-0.2.1.tgz')
  await writeFile(target,data);return target
 }
 const path=await realpath(resolve(input))
 if(!path.endsWith('.tgz'))throw Error('The im-kit integration input must be a release .tgz archive')
 return path
}
/** Copy release inputs into the run and record hashes before profile installation. */
export async function stageInputs(area,paths){
 const directory=join(area,'archives');await mkdir(directory,{recursive:true})
 if(new Set(paths.map(path=>basename(path))).size!==paths.length)throw Error('Integration archives must have distinct filenames')
 const records=[]
 for(const input of paths){
  const target=join(directory,basename(input));await copyFile(input,target)
  const data=await readFile(target)
  records.push({name:basename(target),sha256:createHash('sha256').update(data).digest('hex'),bytes:data.byteLength})
 }
 await writeFile(join(area,'inputs.json'),JSON.stringify(records,null,2)+'\n')
 return paths.map(path=>join(directory,basename(path)))
}
