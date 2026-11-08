/**
 * Bound one optional routing operation without waiting for an uncooperative provider.
 * @param signal - subscriber lifetime.
 * @param timeoutMs - routing deadline.
 * @param run - provider work that receives the combined abort signal.
 * @returns the provider result before cancellation or deadline.
 */
export async function routingDeadline<T>(signal:AbortSignal,timeoutMs:number,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const combined=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])
  combined.throwIfAborted()
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>{combined.removeEventListener('abort',abort);reject(combined.reason)}
    combined.addEventListener('abort',abort,{once:true})
    Promise.resolve().then(()=>{combined.throwIfAborted();return run(combined)}).then(
      value=>{combined.removeEventListener('abort',abort);resolve(value)},
      error=>{combined.removeEventListener('abort',abort);reject(error)},
    )
  })
}
