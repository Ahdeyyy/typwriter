//! Grammar and style checking, powered by [Harper](https://writewithharper.com).
//!
//! * [`typst_parser`] — a Harper `Parser` for Typst, written directly against
//!   the `typst-syntax` version this app pins.
//! * [`format`] — decides which parser (if any) a given file gets.
//! * [`engine`] — owns the dictionary and lint configuration, and turns lints
//!   into something the frontend can render.

pub mod engine;
pub mod format;
pub mod maskers;
pub mod typst_parser;
