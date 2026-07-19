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

        let mut cmd = Command::new("tinymist");
        cmd.arg("lsp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // No console window flash on Windows.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

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
