/** Create this package's documented output directory before npm writes the archive. */
import {mkdir} from 'node:fs/promises'
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true})
