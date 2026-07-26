// Owns the external `tinymist` language-server child process.
//
// The Rust side understands only LSP *framing* (`Content-Length` headers); it
// has no notion of JSON-RPC semantics. All protocol logic lives in the frontend
// via `@codemirror/lsp-client`. We spawn `tinymist lsp`, de-frame its stdout and
// forward each JSON body to the webview as an `lsp://message` event, and pipe
// messages from the frontend back to its stdin. If `tinymist` isn't installed
// (or fails to spawn) `start` returns `false` — the editor then transparently
// falls back to the in-process `typst-ide` language features.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::thread::JoinHandle;

use log::{info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

/// Event carrying one de-framed JSON-RPC message body from the server.
pub const LSP_MESSAGE_EVENT: &str = "lsp://message";
/// Event emitted once, when the server's stdout closes (it exited/crashed).
pub const LSP_CLOSED_EVENT: &str = "lsp://closed";

/// A spawned tinymist process plus the threads pumping its output.
struct LspProcess {
    child: Child,
    stdin: ChildStdin,
    reader: Option<JoinHandle<()>>,
    stderr: Option<JoinHandle<()>>,
}

/// Tauri-managed state owning the (optional) running language server.
#[derive(Default)]
pub struct LspState {
    inner: Mutex<Option<LspProcess>>,
}

impl LspState {
    /// Spawn a fresh `tinymist lsp`, returning whether a server is available
    /// afterwards. Never panics: a failed spawn simply returns `false` — the
    /// "tinymist not installed" fallback signal.
    pub fn start<R: Runtime>(&self, app: &AppHandle<R>) -> bool {
        let mut guard = self.inner.lock().unwrap();

        // Always start fresh: each frontend session sends a new `initialize`,
        // which an already-initialized server must reject — reuse would
        // guarantee a failed first handshake after e.g. a webview reload.
        if let Some(mut proc) = guard.take() {
            let _ = proc.child.kill();
            let _ = proc.child.wait();
            if let Some(handle) = proc.reader.take() {
                let _ = handle.join();
            }
            if let Some(handle) = proc.stderr.take() {
                let _ = handle.join();
            }
        }

        let mut cmd = tinymist_command();
        cmd.arg("lsp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(err) => {
                info!("lsp: tinymist not found ({err}); using built-in language features");
                return false;
            }
        };

        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let _ = child.kill();
                warn!("lsp: failed to capture tinymist stdin");
                return false;
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let reader = stdout.map(|stdout| {
            let app = app.clone();
            std::thread::spawn(move || read_loop(stdout, app))
        });
        let stderr = stderr.map(|stderr| {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.trim().is_empty() => info!("tinymist: {line}"),
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
            })
        });

        *guard = Some(LspProcess {
            child,
            stdin,
            reader,
            stderr,
        });
        info!("lsp: tinymist language server started");
        true
    }

    /// Frame `message` with an LSP `Content-Length` header and write it to the
    /// child's stdin. Errors if no process is running.
    pub fn send(&self, message: &str) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        let proc = guard
            .as_mut()
            .ok_or_else(|| "lsp: no language server running".to_string())?;

        let body = message.as_bytes();
        write!(proc.stdin, "Content-Length: {}\r\n\r\n", body.len())
            .and_then(|()| proc.stdin.write_all(body))
            .and_then(|()| proc.stdin.flush())
            .map_err(|err| format!("lsp: write to tinymist failed: {err}"))
    }

    /// Kill the child, wait on it, and join the pump threads. Killing the child
    /// closes its pipes, which unblocks the reader/stderr threads.
    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(mut proc) = guard.take() {
            let _ = proc.child.kill();
            let _ = proc.child.wait();
            if let Some(handle) = proc.reader.take() {
                let _ = handle.join();
            }
            if let Some(handle) = proc.stderr.take() {
                let _ = handle.join();
            }
            info!("lsp: tinymist language server stopped");
        }
    }
}

/// A `tinymist` invocation with the platform tweaks we always want (no console
/// window flash on Windows).
fn tinymist_command() -> Command {
    let cmd = Command::new("tinymist");
    #[cfg(windows)]
    let cmd = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };
    cmd
}

/// Whether the `tinymist` CLI can be found, reported to the settings UI so the
/// language-server toggle can say *why* it's unavailable instead of silently
/// falling back — and, when it is found, which Typst it speaks.
///
/// tinymist embeds its own copy of the Typst compiler, independent of the one
/// this app links. When the two disagree the language server can report
/// completions, hovers and diagnostics that don't match what the app actually
/// compiles, so the settings UI surfaces both versions.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LspAvailability {
    /// `tinymist` was found on `PATH` and could be executed.
    pub available: bool,
    /// tinymist's own release version (e.g. `0.15.2`), when it reported one.
    pub version: Option<String>,
    /// The Typst version tinymist was built against (e.g. `0.15.0`).
    pub typst_version: Option<String>,
    /// The Typst version *this app* compiles with.
    pub bundled_typst_version: String,
    /// Whether tinymist's Typst matches ours closely enough to trust its
    /// answers. `None` when tinymist didn't report a Typst version at all
    /// (an old build, or an output format we don't recognize).
    pub typst_compatible: Option<bool>,
}

impl LspAvailability {
    /// The "tinymist isn't there" answer — still carries our own Typst version
    /// so the UI has something to show either way.
    pub fn unavailable() -> Self {
        Self {
            available: false,
            version: None,
            typst_version: None,
            bundled_typst_version: bundled_typst_version().to_string(),
            typst_compatible: None,
        }
    }
}

/// The Typst version this app compiles documents with.
pub fn bundled_typst_version() -> &'static str {
    typst::utils::version().raw()
}

/// Probe for the CLI by running `tinymist --version`. Blocking (spawns a
/// process and waits for it) — call it off the main thread.
///
/// A successful *spawn* is what makes the binary "available": a version flag
/// that errors out still means tinymist is installed, and `lsp_start` would
/// work. Only a spawn failure (not found / not executable) reports `false`.
pub fn probe() -> LspAvailability {
    let output = tinymist_command()
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut availability = parse_version_output(&stdout);
            availability.available = true;
            info!(
                "lsp: tinymist found (tinymist {}, typst {}; app bundles typst {})",
                availability.version.as_deref().unwrap_or("?"),
                availability.typst_version.as_deref().unwrap_or("?"),
                availability.bundled_typst_version,
            );
            availability
        }
        Err(err) => {
            info!("lsp: tinymist not found ({err})");
            LspAvailability::unavailable()
        }
    }
}

/// Pull the versions out of `tinymist --version`, which prints a name line
/// followed by a `Key:   value` block:
///
/// ```text
/// tinymist
/// Build Git Describe:  v0.15.2
/// Typst Version:       0.15.0
/// ```
///
/// Returns an `unavailable()` shell with whatever could be parsed filled in —
/// the caller flips `available` once it knows the binary ran.
fn parse_version_output(stdout: &str) -> LspAvailability {
    // Older/other builds print `tinymist 0.13.0` on the first line and no
    // key/value block, so fall back to the token after the program name.
    let name_line_version = stdout
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .map(str::to_string);

    let version = field(stdout, "Build Git Describe")
        .map(|v| v.trim_start_matches('v').to_string())
        .or(name_line_version);
    let typst_version = field(stdout, "Typst Version").map(str::to_string);

    let typst_compatible = typst_version
        .as_deref()
        .map(|theirs| major_minor(theirs) == major_minor(bundled_typst_version()));

    LspAvailability {
        version,
        typst_version,
        typst_compatible,
        ..LspAvailability::unavailable()
    }
}

/// The value of a `Key: value` line, matched case-insensitively.
fn field<'a>(stdout: &'a str, key: &str) -> Option<&'a str> {
    stdout
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case(key))
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
}

/// `major.minor` of a dotted version, ignoring any pre-release/build suffix.
/// Typst is pre-1.0, so the *minor* number is its breaking-change level: two
/// builds that agree on `major.minor` accept the same language. `None` for
/// anything unparseable, which compares unequal to a real version.
fn major_minor(version: &str) -> Option<(u64, u64)> {
    let core = version.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real `tinymist --version` output (0.15.2), with the bundled Typst version
    /// spliced in so the test doesn't break every time we bump Typst.
    fn version_output(typst: &str) -> String {
        format!(
            "tinymist \n\
             Build Timestamp:     2026-06-22T10:34:37.975175300Z\n\
             Build Git Describe:  v0.15.2\n\
             Commit SHA:          92babed1bc00540882effd29bc56ebc5986792c2\n\
             Cargo Target Triple: x86_64-pc-windows-msvc\n\
             Typst Version:       {typst}\n\
             Typst Source:        git+https://github.com/Myriad-Dreamin/typst.git\n"
        )
    }

    #[test]
    fn parses_versions_from_the_key_value_block() {
        let parsed = parse_version_output(&version_output("0.15.0"));
        assert_eq!(parsed.version.as_deref(), Some("0.15.2"));
        assert_eq!(parsed.typst_version.as_deref(), Some("0.15.0"));
    }

    #[test]
    fn matching_typst_minor_is_compatible() {
        let ours = bundled_typst_version().to_string();
        let parsed = parse_version_output(&version_output(&ours));
        assert_eq!(parsed.typst_compatible, Some(true));
        assert_eq!(parsed.bundled_typst_version, ours);
    }

    #[test]
    fn differing_typst_minor_is_incompatible() {
        let parsed = parse_version_output(&version_output("0.13.1"));
        assert_eq!(parsed.typst_compatible, Some(false));
    }

    #[test]
    fn patch_differences_do_not_trip_the_warning() {
        let (major, minor) = major_minor(bundled_typst_version()).unwrap();
        let parsed = parse_version_output(&version_output(&format!("{major}.{minor}.99")));
        assert_eq!(parsed.typst_compatible, Some(true));
    }

    #[test]
    fn falls_back_to_the_name_line_when_there_is_no_block() {
        let parsed = parse_version_output("tinymist 0.13.0\n");
        assert_eq!(parsed.version.as_deref(), Some("0.13.0"));
        // No Typst version reported → unknown, not "incompatible".
        assert_eq!(parsed.typst_version, None);
        assert_eq!(parsed.typst_compatible, None);
    }

    #[test]
    fn unparseable_output_reports_no_versions() {
        let parsed = parse_version_output("");
        assert_eq!(parsed.version, None);
        assert_eq!(parsed.typst_version, None);
        assert_eq!(parsed.typst_compatible, None);
    }

    #[test]
    fn major_minor_ignores_prefixes_and_suffixes() {
        assert_eq!(major_minor("v0.15.2-4-gabcdef"), Some((0, 15)));
        assert_eq!(major_minor("0.15"), Some((0, 15)));
        assert_eq!(major_minor("nightly"), None);
    }
}

/// Window hosting the LSP client. Events are targeted there rather than
/// broadcast — the preview popout has no client and shouldn't pay the
/// serialization cost of (large) semantic-token payloads.
const MAIN_WINDOW: &str = "main";

/// De-frame `Content-Length`-prefixed messages from the server's stdout and
/// emit each JSON body as an `lsp://message` event. Emits `lsp://closed` when
/// stdout reaches EOF or errors.
fn read_loop<R: Runtime>(stdout: ChildStdout, app: AppHandle<R>) {
    let mut reader = BufReader::new(stdout);
    loop {
        // ── Headers: read lines until a blank line terminates the header block.
        let mut content_length: Option<usize> = None;
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = app.emit_to(MAIN_WINDOW, LSP_CLOSED_EVENT, ());
                    return;
                }
                Ok(_) => {}
                Err(err) => {
                    warn!("lsp: read from tinymist failed: {err}");
                    let _ = app.emit_to(MAIN_WINDOW, LSP_CLOSED_EVENT, ());
                    return;
                }
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
                content_length = rest.trim().parse::<usize>().ok();
            }
        }

        // ── Body: read exactly `Content-Length` bytes.
        let Some(len) = content_length else {
            // Malformed frame with no length; skip and resync on the next header.
            continue;
        };
        let mut body = vec![0u8; len];
        if let Err(err) = reader.read_exact(&mut body) {
            warn!("lsp: incomplete message from tinymist: {err}");
            let _ = app.emit_to(MAIN_WINDOW, LSP_CLOSED_EVENT, ());
            return;
        }
        match String::from_utf8(body) {
            Ok(message) => {
                let _ = app.emit_to(MAIN_WINDOW, LSP_MESSAGE_EVENT, message);
            }
            Err(err) => warn!("lsp: non-utf8 message body: {err}"),
        }
    }
}
