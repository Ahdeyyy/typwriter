//! True presentation mode: park a window borderless-fullscreen on a chosen
//! display and keep it there while the user works in other applications.
//!
//! Why this lives in Rust rather than in the frontend's window store:
//!
//! * **Ordering.** Entering presentation is a sequence — save geometry, move to
//!   the target display, resize, go fullscreen, go topmost, focus. Driven from
//!   JS that is six IPC round-trips, each one queued onto tao's window thread
//!   independently; a single command runs them in order.
//! * **The taskbar.** `set_fullscreen` alone does *not* keep the Windows
//!   taskbar down. tao calls `ITaskbarList2::MarkFullscreenWindow`, and the
//!   shell only demotes the taskbar while that window is *active* — alt-tab to
//!   another app and the taskbar pops back over the projected slide. The only
//!   focus-independent lever is `WS_EX_TOPMOST`, i.e. `set_always_on_top`.
//! * **Which display.** Tauri's `set_fullscreen(bool)` maps to
//!   `Fullscreen::Borderless(None)`, which resolves to whatever monitor the
//!   window currently overlaps most. Targeting the projector therefore means
//!   moving the window there *first*, so fullscreen is a geometric no-op.
//! * The keep-awake inhibitor and the Aero-Peek exclusion below have no
//!   frontend equivalent at all.

use std::collections::HashMap;

use log::{info, warn};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

/// The window that hosts the projected slide. Presentation reuses the preview
/// popout rather than introducing a third window label: the preview store, the
/// `preview` keybinding scope and the cross-window page channel are all already
/// wired to it, which also makes the main window's preview pane a presenter
/// remote for free.
pub const PRESENTATION_WINDOW: &str = "preview";

/// One connected display, as offered to the presentation display picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// Stable-ish OS identifier (`\\.\DISPLAY2` on Windows). This is what gets
    /// persisted when the user pins a display, so an unplugged projector
    /// simply stops matching instead of silently retargeting another screen.
    pub id: String,
    /// Raw monitor name, when the OS gives us one.
    pub name: Option<String>,
    /// Position in the virtual desktop, physical pixels.
    pub x: i32,
    pub y: i32,
    /// Resolution in physical pixels — the frontend sizes its render scale off
    /// this so a slide isn't upscaled from a too-small render.
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
    /// The display the main editor window is currently on. Presentation
    /// defaults to *any other* display, which is the right answer for the
    /// common laptop + HDMI-extend rig.
    pub is_main_window: bool,
}

impl DisplayInfo {
    fn from_monitor(index: usize, monitor: &Monitor, primary: bool, main_window: bool) -> Self {
        let name = monitor.name().cloned();
        Self {
            id: name.clone().unwrap_or_else(|| format!("display-{index}")),
            name,
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale_factor: monitor.scale_factor(),
            is_primary: primary,
            is_main_window: main_window,
        }
    }
}

/// Window geometry captured on the way into presentation mode.
///
/// tao saves its own placement when it enters fullscreen, but by then we have
/// already moved the window onto the projector — its restore would drop the
/// window back onto the projector at monitor size. So we snapshot the *real*
/// pre-presentation bounds ourselves and reapply them after leaving fullscreen.
struct SavedGeometry {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    maximized: bool,
}

/// Managed state for presentation mode. Keyed by window label so a future
/// second presentation surface doesn't need a second state type.
#[derive(Default)]
pub struct PresentationState {
    saved: Mutex<HashMap<String, SavedGeometry>>,
    awake: Mutex<Option<AwakeGuard>>,
}

// ── Display enumeration ─────────────────────────────────────────────────────

fn monitors_of(app: &AppHandle) -> Result<(Vec<Monitor>, Option<Monitor>, Option<Monitor>), String> {
    // Monitor enumeration is a per-window dispatcher call in Tauri, but the
    // answer is process-wide — any live window will do.
    let anchor = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| "no window available to enumerate displays from".to_string())?;

    let monitors = anchor
        .available_monitors()
        .map_err(|e| format!("failed to list displays: {e}"))?;
    let primary = anchor.primary_monitor().unwrap_or(None);
    let main_monitor = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten());

    Ok((monitors, primary, main_monitor))
}

/// Two monitors are "the same" when they start at the same virtual-desktop
/// origin. Names are not reliably unique (and are `None` on some platforms),
/// but two displays can never share a top-left corner.
fn same_monitor(a: &Monitor, b: &Monitor) -> bool {
    a.position() == b.position()
}

/// Every connected display, annotated for the presentation display picker.
#[tauri::command]
pub async fn list_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let (monitors, primary, main_monitor) = monitors_of(&app)?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let is_primary = primary.as_ref().is_some_and(|p| same_monitor(p, m));
            let is_main = main_monitor.as_ref().is_some_and(|p| same_monitor(p, m));
            DisplayInfo::from_monitor(i, m, is_primary, is_main)
        })
        .collect())
}

/// Resolve the display to present on.
///
/// An explicit `id` wins when it still matches something connected — a pinned
/// projector that has been unplugged falls through to auto rather than
/// throwing the slide onto whatever display inherited its index. Auto prefers
/// a display the main editor window is *not* on, then a non-primary one, and
/// finally gives up and uses the display the window is already on.
fn resolve_target(
    monitors: &[Monitor],
    primary: Option<&Monitor>,
    main_monitor: Option<&Monitor>,
    id: Option<&str>,
) -> Option<usize> {
    if let Some(id) = id {
        let pinned = monitors
            .iter()
            .position(|m| m.name().map(String::as_str) == Some(id));
        if pinned.is_some() {
            return pinned;
        }
        warn!("present: pinned display {id:?} is not connected; falling back to auto");
    }

    let off_main = |m: &Monitor| !main_monitor.is_some_and(|main| same_monitor(main, m));

    monitors
        .iter()
        .position(|m| off_main(m) && !primary.is_some_and(|p| same_monitor(p, m)))
        .or_else(|| monitors.iter().position(|m| off_main(m)))
        .or(if monitors.is_empty() { None } else { Some(0) })
}

// ── Enter / exit ────────────────────────────────────────────────────────────

/// Put `PRESENTATION_WINDOW` borderless-fullscreen on `display`, above the
/// taskbar, and keep it there when focus moves elsewhere.
///
/// Returns the display it actually landed on so the caller can pick a render
/// scale that matches the projector's pixel width.
#[tauri::command]
pub async fn enter_presentation(
    app: AppHandle,
    display: Option<String>,
) -> Result<DisplayInfo, String> {
    let window = app
        .get_webview_window(PRESENTATION_WINDOW)
        .ok_or_else(|| format!("window {PRESENTATION_WINDOW:?} is not open"))?;

    let (monitors, primary, main_monitor) = monitors_of(&app)?;
    let index = resolve_target(
        &monitors,
        primary.as_ref(),
        main_monitor.as_ref(),
        display.as_deref(),
    )
    .ok_or_else(|| "no displays detected".to_string())?;
    let target = &monitors[index];
    let position = *target.position();
    let size = *target.size();

    let state = app.state::<PresentationState>();

    // Snapshot the pre-presentation bounds, but never overwrite an existing
    // snapshot: a re-entry (display switch mid-presentation) must still be able
    // to restore the *original* windowed geometry on exit.
    {
        let mut saved = state.saved.lock();
        if !saved.contains_key(PRESENTATION_WINDOW) {
            let position = window
                .outer_position()
                .map_err(|e| format!("failed to read window position: {e}"))?;
            let size = window
                .outer_size()
                .map_err(|e| format!("failed to read window size: {e}"))?;
            let maximized = window.is_maximized().unwrap_or(false);
            saved.insert(
                PRESENTATION_WINDOW.to_string(),
                SavedGeometry {
                    position,
                    size,
                    maximized,
                },
            );
        }
    }

    // A maximized window can't be moved between displays — unmaximize first, or
    // the position/size below are silently dropped and fullscreen lands on the
    // wrong monitor.
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }

    // Topmost before fullscreen. tao applies `WS_EX_TOPMOST` through
    // `SetWindowPos(HWND_TOPMOST, .., SWP_NOACTIVATE)`, but the *style* change
    // that fullscreen makes afterwards deliberately activates the window — so
    // doing it in this order means the single activation happens at the end,
    // where we want it, instead of twice.
    window
        .set_always_on_top(true)
        .map_err(|e| format!("failed to pin the presentation window on top: {e}"))?;

    // Position before size: crossing to a display with a different scale factor
    // raises WM_DPICHANGED, which itself resizes the window. Sizing after that
    // means our size is the one that sticks.
    window
        .set_position(position)
        .map_err(|e| format!("failed to move to the target display: {e}"))?;
    window
        .set_size(size)
        .map_err(|e| format!("failed to size to the target display: {e}"))?;

    // Now a geometric no-op — it exists to strip the window styles and to tell
    // the shell (via MarkFullscreenWindow) that this is a fullscreen window.
    window
        .set_fullscreen(true)
        .map_err(|e| format!("failed to enter fullscreen: {e}"))?;

    let _ = window.set_focus();

    set_peek_excluded(&window, true);
    *state.awake.lock() = AwakeGuard::acquire();

    let info = DisplayInfo::from_monitor(
        index,
        target,
        primary.as_ref().is_some_and(|p| same_monitor(p, target)),
        main_monitor
            .as_ref()
            .is_some_and(|p| same_monitor(p, target)),
    );
    info!(
        "present: entered on display {:?} at {},{} {}x{}",
        info.id, info.x, info.y, info.width, info.height
    );
    Ok(info)
}

/// Leave presentation mode and put the window back where it was.
#[tauri::command]
pub async fn exit_presentation(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(PRESENTATION_WINDOW)
        .ok_or_else(|| format!("window {PRESENTATION_WINDOW:?} is not open"))?;

    let state = app.state::<PresentationState>();
    // Drop the inhibitor first: it must be released even if a window call below
    // fails, or the display never sleeps again for the rest of the session.
    *state.awake.lock() = None;
    set_peek_excluded(&window, false);

    window
        .set_fullscreen(false)
        .map_err(|e| format!("failed to leave fullscreen: {e}"))?;
    window
        .set_always_on_top(false)
        .map_err(|e| format!("failed to unpin the presentation window: {e}"))?;

    // tao's own fullscreen restore reapplies the placement it captured *after*
    // we moved the window onto the projector, so it lands back there at monitor
    // size. Reapply the real pre-presentation bounds on top of it.
    let saved = state.saved.lock().remove(PRESENTATION_WINDOW);
    if let Some(geometry) = saved {
        let _ = window.set_position(geometry.position);
        let _ = window.set_size(geometry.size);
        if geometry.maximized {
            let _ = window.maximize();
        }
    }

    info!("present: exited");
    Ok(())
}

/// Forget any saved geometry for the presentation window.
///
/// Called when the popout closes: its bounds are gone, and a stale snapshot
/// would be reapplied to a *newly created* window the next time presentation
/// exits, teleporting it to wherever the previous one happened to sit.
pub fn forget_geometry(app: &AppHandle) {
    if let Some(state) = app.try_state::<PresentationState>() {
        state.saved.lock().remove(PRESENTATION_WINDOW);
        *state.awake.lock() = None;
    }
}

// ── Windows: keep the projected slide from being ghosted by Peek ────────────

/// Exclude the window from Aero Peek.
///
/// Hovering another app's taskbar thumbnail makes Windows ghost every other
/// window to reveal that one — including a slide on the projector, which is a
/// visible flash for the audience. `DWMWA_EXCLUDED_FROM_PEEK` opts out.
/// Peek is off by default on Windows 11, so this is mostly Windows 10 cover.
#[cfg(windows)]
fn set_peek_excluded(window: &WebviewWindow, excluded: bool) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_EXCLUDED_FROM_PEEK};

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let value: i32 = i32::from(excluded);
    // SAFETY: `hwnd` is a live window handle owned by the runtime for as long
    // as `window` is alive, and `value` outlives the call.
    let hr = unsafe {
        DwmSetWindowAttribute(
            hwnd.0 as *mut core::ffi::c_void,
            DWMWA_EXCLUDED_FROM_PEEK as u32,
            (&raw const value).cast(),
            std::mem::size_of::<i32>() as u32,
        )
    };
    if hr < 0 {
        warn!("present: DwmSetWindowAttribute(EXCLUDED_FROM_PEEK) failed: 0x{hr:08x}");
    }
}

#[cfg(not(windows))]
fn set_peek_excluded(_window: &WebviewWindow, _excluded: bool) {}

// ── Keep the display awake for the length of the presentation ───────────────

/// Holds off display/system sleep while a presentation is on screen. Dropping
/// it releases the request.
// Off Windows it is never constructed (see the `acquire` stub below), so the
// CI build on Linux would otherwise flag it as dead.
#[cfg_attr(not(windows), allow(dead_code))]
struct AwakeGuard {
    #[cfg(windows)]
    stop: std::sync::mpsc::Sender<()>,
    #[cfg(windows)]
    thread: Option<std::thread::JoinHandle<()>>,
}

#[cfg(windows)]
impl AwakeGuard {
    fn acquire() -> Option<Self> {
        use std::sync::mpsc;
        use windows_sys::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        };

        let (stop, rx) = mpsc::channel::<()>();
        // `SetThreadExecutionState` is thread-affine: the request dies with the
        // thread that made it. Tauri commands run on a pool, so the request has
        // to be owned by a thread we keep alive for the whole presentation.
        let thread = std::thread::Builder::new()
            .name("typwriter-keep-awake".into())
            .spawn(move || {
                // SAFETY: no arguments beyond a flags bitfield; safe on any thread.
                let prev = unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED)
                };
                if prev == 0 {
                    warn!("present: SetThreadExecutionState failed; display may sleep");
                    return;
                }
                // Park until the guard is dropped.
                let _ = rx.recv();
                // SAFETY: same call, clearing the request before the thread dies.
                unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            })
            .map_err(|e| warn!("present: keep-awake thread failed to start: {e}"))
            .ok()?;

        Some(Self {
            stop,
            thread: Some(thread),
        })
    }
}

#[cfg(windows)]
impl Drop for AwakeGuard {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(not(windows))]
impl AwakeGuard {
    /// No inhibitor outside Windows yet — macOS wants an `IOPMAssertion` and
    /// Linux the `org.freedesktop.ScreenSaver` inhibit interface.
    fn acquire() -> Option<Self> {
        None
    }
}

#[cfg(test)]
mod tests {
    /// `resolve_target` is the only part of this module with real branching,
    /// and the only part testable without a window server. `Monitor`'s fields
    /// are crate-private in Tauri, so the cases below drive the same logic
    /// through a local stand-in with the same shape.
    #[derive(Clone, PartialEq)]
    struct FakeMonitor {
        name: Option<String>,
        x: i32,
    }

    /// Mirror of `resolve_target` over `FakeMonitor`. Kept structurally
    /// identical so the branch order stays covered.
    fn resolve(
        monitors: &[FakeMonitor],
        primary: Option<&FakeMonitor>,
        main: Option<&FakeMonitor>,
        id: Option<&str>,
    ) -> Option<usize> {
        if let Some(id) = id {
            let pinned = monitors
                .iter()
                .position(|m| m.name.as_deref() == Some(id));
            if pinned.is_some() {
                return pinned;
            }
        }
        let off_main = |m: &FakeMonitor| !main.is_some_and(|main| main.x == m.x);
        monitors
            .iter()
            .position(|m| off_main(m) && !primary.is_some_and(|p| p.x == m.x))
            .or_else(|| monitors.iter().position(|m| off_main(m)))
            .or(if monitors.is_empty() { None } else { Some(0) })
    }

    fn monitor(name: &str, x: i32) -> FakeMonitor {
        FakeMonitor {
            name: Some(name.to_string()),
            x,
        }
    }

    #[test]
    fn auto_picks_the_display_the_editor_is_not_on() {
        let laptop = monitor(r"\\.\DISPLAY1", 0);
        let projector = monitor(r"\\.\DISPLAY2", 2560);
        let monitors = vec![laptop.clone(), projector];
        assert_eq!(
            resolve(&monitors, Some(&laptop), Some(&laptop), None),
            Some(1)
        );
    }

    #[test]
    fn auto_falls_back_to_the_only_display() {
        let laptop = monitor(r"\\.\DISPLAY1", 0);
        let monitors = vec![laptop.clone()];
        assert_eq!(
            resolve(&monitors, Some(&laptop), Some(&laptop), None),
            Some(0)
        );
    }

    #[test]
    fn a_pinned_display_wins_over_auto() {
        let laptop = monitor(r"\\.\DISPLAY1", 0);
        let projector = monitor(r"\\.\DISPLAY2", 2560);
        let monitors = vec![laptop.clone(), projector];
        // Pinning the display the editor is on is a legitimate choice.
        assert_eq!(
            resolve(&monitors, Some(&laptop), Some(&laptop), Some(r"\\.\DISPLAY1")),
            Some(0)
        );
    }

    #[test]
    fn an_unplugged_pinned_display_falls_back_to_auto() {
        let laptop = monitor(r"\\.\DISPLAY1", 0);
        let monitors = vec![laptop.clone()];
        assert_eq!(
            resolve(&monitors, Some(&laptop), Some(&laptop), Some(r"\\.\DISPLAY9")),
            Some(0)
        );
    }

    #[test]
    fn auto_prefers_a_non_primary_display_over_another_secondary() {
        // Editor on the primary; two extra displays. The first non-primary,
        // non-editor display wins.
        let primary = monitor(r"\\.\DISPLAY1", 0);
        let second = monitor(r"\\.\DISPLAY2", 2560);
        let third = monitor(r"\\.\DISPLAY3", 4480);
        let monitors = vec![primary.clone(), second, third];
        assert_eq!(
            resolve(&monitors, Some(&primary), Some(&primary), None),
            Some(1)
        );
    }
}
