/** JSON object narrowing shared by owner-operation parsers. */

/**
 * Admit only a non-null, non-array object from an external request.
 * @param value - untrusted JSON value.
 * @returns whether field parsing may inspect string keys.
 */
export function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
