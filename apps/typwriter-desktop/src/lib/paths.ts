// Path utilities. On Windows Rust's `Path::display()` uses backslashes, but the
// editor (CodeMirror, IPC payloads, tab ids) works with forward-slash strings,
// so paths crossing the FFI boundary or getting compared/stored are normalized.

export function normalize(path: string): string {
    return path.replace(/\\/g, '/');
}

// Remove only the actual home directory, respecting directory boundaries.
// Keep the original path when home is unknown or the path is elsewhere.
export function shortenHomePath(path: string, homePath: string | null): string {
    if (!homePath) return path;
    const normalized = normalize(path);
    const home = normalize(homePath).replace(/\/+$/, '');
    if (!home) return path;
    const isWindowsPath = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//');
    const comparedPath = isWindowsPath ? normalized.toLowerCase() : normalized;
    const comparedHome = isWindowsPath ? home.toLowerCase() : home;
    if (comparedPath === comparedHome) return '';
    return comparedPath.startsWith(`${comparedHome}/`)
        ? normalized.slice(home.length + 1)
        : path;
}

// Where a workspace sits — the subtitle under its name in the workspace
// switcher and on the home screen. The name line already says which workspace
// it is, so this is the parent folder, relative to home (`~/Documents`): short,
// but always unique, so two `notes` never look alike. Folders outside home keep
// their full path, and a drive root reads as its letter (`D:`).
export function workspaceLocation(path: string, homePath: string | null): string {
    const parent = dirname(normalize(path).replace(/(.)\/+$/, '$1'));
    if (!parent) return '';
    if (/^[A-Za-z]:\/$/.test(parent)) return parent.slice(0, 2);
    const relative = shortenHomePath(parent, homePath);
    if (relative === '') return '~';
    return relative === parent ? parent : `~/${relative}`;
}

export function basename(path: string): string {
    return normalize(path).split('/').pop() ?? path;
}

export function dirname(path: string): string {
    const normalized = normalize(path);
    const idx = normalized.lastIndexOf('/');
    if (idx === 0) return '/';
    if (idx === 2 && /^[A-Za-z]:\//.test(normalized)) return normalized.slice(0, 3);
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
