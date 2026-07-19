// Path utilities. On Windows Rust's `Path::display()` uses backslashes, but the
// editor (CodeMirror, IPC payloads, tab ids) works with forward-slash strings,
// so paths crossing the FFI boundary or getting compared/stored are normalized.

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

// Default a bare filename to a Typst document. `file` → `file.typ`, while names
// that already carry an extension (`report.pdf`, `letter.typ`) or are dotfiles
// (`.gitignore`) are left untouched.
export function ensureTypExtension(name: string): string {
    const leaf = basename(name);
    if (/\.[^./\\]+$/.test(leaf)) return name;
    return name.endsWith('.') ? `${name}typ` : `${name}.typ`;
}
