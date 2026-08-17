// Comparison for "does this view already show exactly these diagnostics?".
//
// Extracted from the editor component so it can be unit-tested: it decides
// whether a `setDiagnostics` dispatch happens at all, and every such dispatch
// closes an open lint tooltip (the lint extension's `hideOn`). Getting it wrong
// in the "changed" direction makes tooltips vanish mid-read on every compile;
// getting it wrong in the "unchanged" direction leaves stale marks on screen.

export interface DiagnosticMark {
    from: number;
    to: number;
    severity: string;
    message: string;
}

function key(d: DiagnosticMark): string {
    return `${d.from}:${d.to}:${d.severity}:${d.message}`;
}

/**
 * Whether `existing` and `wanted` describe the same set of diagnostics.
 *
 * O(n) with an early exit, rather than sorting two key arrays — this runs for
 * every open view on every compile. Duplicates (identical position, severity
 * and message) are indistinguishable here, and re-dispatching them would be a
 * no-op either way, so set semantics lose nothing.
 */
export function diagnosticsMatch(
    existing: readonly DiagnosticMark[],
    wanted: readonly DiagnosticMark[]
): boolean {
    if (existing.length !== wanted.length) return false;
    const keys = new Set(wanted.map(key));
    return existing.every((d) => keys.has(key(d)));
}
