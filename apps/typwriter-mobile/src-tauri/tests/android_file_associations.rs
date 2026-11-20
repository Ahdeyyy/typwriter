#[path = "../android_file_associations.rs"]
mod android_file_associations;

fn attributes<'a>(xml: &'a str, name: &str) -> Vec<&'a str> {
    xml.split(&format!("android:{name}=\""))
        .skip(1)
        .map(|value| value.split('"').next().expect("attribute value"))
        .collect()
}

// Android's simple glob is NOT a regular expression: .* stops at the first
// following literal, with no backtracking. Keep the platform algorithm here so
// dotted paths catch regressions that a normal regex-based test would miss.
// https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/os/PatternMatcher.java
fn android_simple_glob(pattern: &str, path: &str) -> bool {
    let pattern = pattern.as_bytes();
    let path = path.as_bytes();
    let (mut p, mut s) = (0, 0);
    while p < pattern.len() && s < path.len() {
        let mut character = pattern[p];
        p += 1;
        let escaped = character == b'\\';
        if escaped {
            character = pattern[p];
            p += 1;
        }
        if pattern.get(p) == Some(&b'*') {
            if !escaped && character == b'.' {
                if p == pattern.len() - 1 {
                    return true;
                }
                p += 1;
                if pattern[p] == b'\\' {
                    p += 1;
                }
                while s < path.len() && path[s] != pattern[p] {
                    s += 1;
                }
                if s == path.len() {
                    return false;
                }
                p += 1;
                s += 1;
            } else {
                while s < path.len() && path[s] == character {
                    s += 1;
                }
                p += 1;
            }
        } else {
            if character != b'.' && path[s] != character {
                return false;
            }
            s += 1;
        }
    }
    (p == pattern.len() && s == path.len()) || &pattern[p..] == b".*"
}

fn filters(xml: &str) -> Vec<&str> {
    xml.split("<intent-filter>")
        .skip(1)
        .map(|filter| filter.split("</intent-filter>").next().unwrap())
        .collect()
}

#[test]
fn wildcard_and_untyped_view_filters_require_a_typ_path() {
    let xml = android_file_associations::intent_filters();
    let filters = filters(&xml);
    assert_eq!(filters.len(), 3);
    assert_eq!(attributes(filters[0], "mimeType"), ["*/*"]);
    assert!(attributes(filters[1], "mimeType").is_empty());
    for filter in &filters[..2] {
        assert!(!attributes(filter, "pathPattern").is_empty());
        assert!(!attributes(filter, "pathSuffix").is_empty());
    }
    for filter in filters {
        assert_eq!(attributes(filter, "scheme"), ["content", "file"]);
        // Scheme AND authority are required or Android ignores path filters.
        // The empty authority also covers file:///storage/... URLs.
        assert_eq!(attributes(filter, "host"), ["*", ""]);
        assert!(filter.contains("android.intent.action.VIEW"));
        assert!(!filter.contains("android.intent.action.SEND"));
    }
}

// Most file managers, Downloads and attachment viewers hand over opaque URIs
// (`content://…/document/42`), which only a MIME filter without paths matches.
// Android has no type for `.typ`, so those arrive as octet-stream.
#[test]
fn opaque_uris_match_on_typst_capable_mime_types_only() {
    let xml = android_file_associations::intent_filters();
    let opaque = filters(&xml)[2];
    assert!(attributes(opaque, "pathPattern").is_empty());
    assert!(attributes(opaque, "pathSuffix").is_empty());
    let types = attributes(opaque, "mimeType");
    assert_eq!(types, android_file_associations::TYPST_MIME_TYPES);
    // Android matches these exactly: nothing here may cover photos, PDFs,
    // archives or plain-text notes.
    for mime in &types {
        assert!(!mime.contains('*'), "{mime}");
    }
    for other in ["image/png", "application/pdf", "application/zip", "text/plain"] {
        assert!(!types.iter().any(|mime| *mime == other), "{other}");
    }
}

#[test]
fn modern_and_legacy_android_accept_typst_paths_and_reject_other_extensions() {
    let xml = android_file_associations::intent_filters();
    // Android's XML resource reader removes one layer of backslash escaping.
    let patterns: Vec<_> = attributes(&xml, "pathPattern")
        .iter()
        .map(|pattern| pattern.replace(r"\\", r"\"))
        .collect();
    let suffixes = attributes(&xml, "pathSuffix");
    for (path, expected) in [
        ("/Download/main.typ", true),
        ("/Download/Hello world.TYP", true),
        ("/Download/mixed.TyP", true),
        ("/document/primary:Download/draft.v2.typ", true),
        ("/storage/emulated/0/com.example.files/日本語.typ", true),
        ("/Download/photo.png", false),
        ("/Download/notes.txt", false),
        ("/Download/export.pdf", false),
        ("/Download/main.typ.png", false),
        ("/Download/main.typ/preview.png", false),
        ("/Download/mainxtyp", false),
        ("/Download/main.typst", false),
        ("/document/42", false),
    ] {
        let legacy = patterns
            .iter()
            .any(|pattern| android_simple_glob(pattern, path));
        assert_eq!(legacy, expected, "Android 7–11: {path}");
        let modern = legacy || suffixes.iter().any(|suffix| path.ends_with(suffix));
        assert_eq!(modern, expected, "Android 12+: {path}");
    }
    let many_dots = format!("/Download/{}typ", "part.".repeat(40));
    assert!(suffixes.iter().any(|suffix| many_dots.ends_with(suffix)));
}
