// paths.ts
//
// Cross-cutting filesystem path utilities. The desktop runs on Windows where
// `Path::display()` uses backslashes; the editor (CodeMirror, IPC payloads,
// tab ids) consistently works with forward-slash strings, so every path that
// crosses the FFI boundary or gets compared/stored needs to be normalized.
//
// Keep these tiny and pure — they are imported by stores, components, and
// controllers alike; growing them invites circular imports.

export function normalize(path: string): string {
    return path.replace(/\\/g, '/');
}

export function basename(path: string): string {
    return normalize(path).split('/').pop() ?? path;
}

export function dirname(path: string): string {
    const normalized = normalize(path);
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(0, idx) : '';
}
