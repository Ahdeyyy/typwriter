// commands/mod.rs
//
// Re-exports all Tauri command handlers so `lib.rs` can import them all from
// one place.

pub mod app;
pub mod click;
pub mod editor;
pub mod export;
pub mod format;
pub mod logs;
pub mod lsp;
pub mod preview;
pub mod settings;
pub mod vcs;
pub mod workspace;
