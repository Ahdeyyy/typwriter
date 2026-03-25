use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    time::SystemTime,
};

use chrono::{DateTime, NaiveDateTime, Timelike, Utc};
use serde::Serialize;
use tauri::{AppHandle, Manager};

const LOG_FILE_NAME: &str = "typwriter-desktop.log";
const LOG_TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";
const LOG_PREFIX_TIMESTAMP_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Unknown,
}

impl LogLevel {
    fn from_prefix(value: &str) -> Self {
        match value {
            "TRACE" => Self::Trace,
            "DEBUG" => Self::Debug,
            "INFO" => Self::Info,
            "WARN" => Self::Warn,
            "ERROR" => Self::Error,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LogEntry {
    pub index: usize,
    pub timestamp: Option<String>,
    pub level: LogLevel,
    pub target: Option<String>,
    pub message: String,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LogChartBucket {
    pub bucket_start: String,
    pub label: String,
    pub info: usize,
    pub warn: usize,
    pub error: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LogFileView {
    pub path: String,
    pub exists: bool,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
    pub raw_line_count: usize,
    pub entry_count: usize,
    pub entries: Vec<LogEntry>,
    pub chart: Vec<LogChartBucket>,
}

#[derive(Debug, Clone)]
struct ParsedLogPrefix {
    timestamp: String,
    target: String,
    level: LogLevel,
    message: String,
}

#[derive(Debug, Default, Clone, Copy)]
struct BucketCounts {
    info: usize,
    warn: usize,
    error: usize,
}

#[tauri::command]
pub fn get_current_log_view(app: AppHandle) -> Result<LogFileView, String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    let path = log_dir.join(LOG_FILE_NAME);
    read_log_view_from_path(&path)
}

fn read_log_view_from_path(path: &Path) -> Result<LogFileView, String> {
    if !path.exists() {
        return Ok(empty_log_view(path));
    }

    let metadata = fs::metadata(path)
        .map_err(|err| format!("failed to read log file metadata {}: {err}", path.display()))?;
    let contents = fs::read_to_string(path)
        .map_err(|err| format!("failed to read log file {}: {err}", path.display()))?;

    let raw_line_count = raw_line_count(&contents);
    let entries = parse_log_entries(&contents);
    let chart = aggregate_chart_buckets(&entries);

    Ok(LogFileView {
        path: path.display().to_string(),
        exists: true,
        size_bytes: metadata.len(),
        modified_at: metadata.modified().ok().and_then(format_system_time),
        raw_line_count,
        entry_count: entries.len(),
        entries,
        chart,
    })
}

fn empty_log_view(path: &Path) -> LogFileView {
    LogFileView {
        path: path.display().to_string(),
        exists: false,
        size_bytes: 0,
        modified_at: None,
        raw_line_count: 0,
        entry_count: 0,
        entries: Vec::new(),
        chart: Vec::new(),
    }
}

fn format_system_time(value: SystemTime) -> Option<String> {
    let timestamp: DateTime<Utc> = value.into();
    Some(timestamp.format(LOG_TIMESTAMP_FORMAT).to_string())
}

fn raw_line_count(contents: &str) -> usize {
    if contents.is_empty() {
        0
    } else {
        contents.split('\n').count()
    }
}

fn parse_log_entries(contents: &str) -> Vec<LogEntry> {
    let mut entries = Vec::new();
    let mut current: Option<LogEntry> = None;

    for line in contents.lines() {
        if let Some(prefix) = parse_log_prefix(line) {
            flush_current(&mut entries, &mut current);
            current = Some(LogEntry {
                index: 0,
                timestamp: Some(prefix.timestamp),
                level: prefix.level,
                target: Some(prefix.target),
                message: prefix.message,
                raw: line.to_string(),
            });
            continue;
        }

        match current.as_mut() {
            Some(entry) => append_continuation(entry, line),
            None => {
                current = Some(LogEntry {
                    index: 0,
                    timestamp: None,
                    level: LogLevel::Unknown,
                    target: None,
                    message: line.to_string(),
                    raw: line.to_string(),
                });
            }
        }
    }

    flush_current(&mut entries, &mut current);
    entries
}

fn flush_current(entries: &mut Vec<LogEntry>, current: &mut Option<LogEntry>) {
    if let Some(mut entry) = current.take() {
        entry.index = entries.len();
        entries.push(entry);
    }
}

fn append_continuation(entry: &mut LogEntry, line: &str) {
    entry.message.push('\n');
    entry.message.push_str(line);
    entry.raw.push('\n');
    entry.raw.push_str(line);
}

fn parse_log_prefix(line: &str) -> Option<ParsedLogPrefix> {
    let (date, rest) = take_bracketed(line)?;
    let (time, rest) = take_bracketed(rest)?;
    let (target, rest) = take_bracketed(rest)?;
    let (level, rest) = take_bracketed(rest)?;

    let timestamp =
        NaiveDateTime::parse_from_str(&format!("{date} {time}"), LOG_PREFIX_TIMESTAMP_FORMAT)
            .ok()?;

    let message = rest.strip_prefix(' ').unwrap_or(rest).to_string();

    Some(ParsedLogPrefix {
        timestamp: timestamp.format(LOG_TIMESTAMP_FORMAT).to_string(),
        target: target.to_string(),
        level: LogLevel::from_prefix(level),
        message,
    })
}

fn take_bracketed(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix('[')?;
    let end = rest.find(']')?;
    let segment = &rest[..end];
    let remaining = &rest[end + 1..];
    Some((segment, remaining))
}

fn aggregate_chart_buckets(entries: &[LogEntry]) -> Vec<LogChartBucket> {
    let mut buckets = BTreeMap::<String, BucketCounts>::new();
    let mut dates = BTreeSet::<String>::new();

    for entry in entries {
        let Some(timestamp) = entry.timestamp.as_deref() else {
            continue;
        };
        let Ok(parsed) = NaiveDateTime::parse_from_str(timestamp, LOG_TIMESTAMP_FORMAT) else {
            continue;
        };
        let Some(minute) = parsed.with_second(0).and_then(|dt| dt.with_nanosecond(0)) else {
            continue;
        };

        match entry.level {
            LogLevel::Info | LogLevel::Warn | LogLevel::Error => {
                let bucket_start = minute.format("%Y-%m-%dT%H:%M:00").to_string();
                dates.insert(bucket_start[..10].to_string());
                let counts = buckets.entry(bucket_start).or_default();
                match entry.level {
                    LogLevel::Info => counts.info += 1,
                    LogLevel::Warn => counts.warn += 1,
                    LogLevel::Error => counts.error += 1,
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let include_date_in_label = dates.len() > 1;

    buckets
        .into_iter()
        .map(|(bucket_start, counts)| LogChartBucket {
            label: format_bucket_label(&bucket_start, include_date_in_label),
            bucket_start,
            info: counts.info,
            warn: counts.warn,
            error: counts.error,
        })
        .collect()
}

fn format_bucket_label(bucket_start: &str, include_date: bool) -> String {
    if include_date {
        format!("{} {}", &bucket_start[5..10], &bucket_start[11..16])
    } else {
        bucket_start[11..16].to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        aggregate_chart_buckets, empty_log_view, parse_log_entries, read_log_view_from_path,
        LogLevel,
    };
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("typwriter-{name}-{suffix}.log"))
    }

    #[test]
    fn parses_single_line_entry() {
        let entries = parse_log_entries(
            "[2026-03-08][00:10:27][desktop_lib::workspace][INFO] opened workspace",
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].timestamp.as_deref(), Some("2026-03-08T00:10:27"));
        assert_eq!(entries[0].target.as_deref(), Some("desktop_lib::workspace"));
        assert_eq!(entries[0].level, LogLevel::Info);
        assert_eq!(entries[0].message, "opened workspace");
        assert_eq!(entries[0].index, 0);
    }

    #[test]
    fn groups_continuation_lines_into_previous_entry() {
        let entries = parse_log_entries(
            "[2026-03-08][00:10:27][webview][ERROR] top line\nsecond line\nthird line",
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, LogLevel::Error);
        assert_eq!(entries[0].message, "top line\nsecond line\nthird line");
        assert_eq!(
            entries[0].raw,
            "[2026-03-08][00:10:27][webview][ERROR] top line\nsecond line\nthird line"
        );
    }

    #[test]
    fn creates_unknown_entry_for_leading_malformed_lines() {
        let entries = parse_log_entries(
            "bad line\nstill bad\n[2026-03-08][00:10:27][desktop_lib][INFO] okay",
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].level, LogLevel::Unknown);
        assert_eq!(entries[0].timestamp, None);
        assert_eq!(entries[0].target, None);
        assert_eq!(entries[0].message, "bad line\nstill bad");
        assert_eq!(entries[1].level, LogLevel::Info);
    }

    #[test]
    fn aggregates_counts_by_minute() {
        let entries = parse_log_entries(
            "[2026-03-08][00:10:27][desktop_lib][INFO] info one\n\
[2026-03-08][00:10:39][desktop_lib][WARN] warn one\n\
[2026-03-08][00:10:44][desktop_lib][ERROR] error one\n\
[2026-03-08][00:11:05][desktop_lib][INFO] info two",
        );

        let chart = aggregate_chart_buckets(&entries);

        assert_eq!(chart.len(), 2);
        assert_eq!(chart[0].bucket_start, "2026-03-08T00:10:00");
        assert_eq!(chart[0].label, "00:10");
        assert_eq!(chart[0].info, 1);
        assert_eq!(chart[0].warn, 1);
        assert_eq!(chart[0].error, 1);
        assert_eq!(chart[1].bucket_start, "2026-03-08T00:11:00");
        assert_eq!(chart[1].info, 1);
    }

    #[test]
    fn preserves_entry_ordering() {
        let entries = parse_log_entries(
            "[2026-03-08][00:10:27][desktop_lib][INFO] one\n\
[2026-03-08][00:11:27][desktop_lib][INFO] two\n\
[2026-03-08][00:12:27][desktop_lib][INFO] three",
        );

        assert_eq!(
            entries.iter().map(|entry| entry.index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.message.as_str())
                .collect::<Vec<_>>(),
            vec!["one", "two", "three"]
        );
    }

    #[test]
    fn returns_empty_view_for_missing_file() {
        let path = unique_temp_path("missing");
        let view = read_log_view_from_path(&path).expect("missing file should return empty view");

        assert_eq!(view, empty_log_view(&path));
    }

    #[test]
    fn reads_existing_log_file() {
        let path = unique_temp_path("existing");
        fs::write(
            &path,
            "[2026-03-08][00:10:27][desktop_lib][INFO] hello\n\
[2026-03-08][00:10:33][desktop_lib][ERROR] failed",
        )
        .expect("write log fixture");

        let view = read_log_view_from_path(&path).expect("existing log file should load");

        assert!(view.exists);
        assert_eq!(view.raw_line_count, 2);
        assert_eq!(view.entry_count, 2);
        assert_eq!(view.entries[1].level, LogLevel::Error);

        fs::remove_file(&path).expect("cleanup log fixture");
    }
}
