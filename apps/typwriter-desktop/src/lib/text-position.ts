// Turning character offsets into line numbers.
//
// Shared by every feature that walks the syntax tree and then has to show the
// user where something is — the outline, the reference index, project search.

/** Offset of the start of each line. Index 0 is line 1. */
export function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') starts.push(i + 1);
    }
    return starts;
}

/** 1-based line containing `offset`, by binary search over `lineStarts`. */
export function lineAt(starts: readonly number[], offset: number): number {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (starts[mid] <= offset) low = mid;
        else high = mid - 1;
    }
    return low + 1;
}
