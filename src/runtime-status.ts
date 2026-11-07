/** Browser-safe counter projections; no source text or model prompt. */
export interface KernelStatus{readonly queued:number;readonly running:number;readonly checking:number;readonly stopping:boolean;readonly lastFailure:string|null}
/** Durable history counters use SQL aggregates instead of loading messages. */
export interface JournalStats{readonly receipts:number;readonly queued:number;readonly running:number;readonly interrupted:number;readonly responded:number;readonly uncertain:number;readonly mappings:number}
