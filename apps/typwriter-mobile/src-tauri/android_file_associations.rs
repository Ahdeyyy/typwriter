/// Android filters for filename-bearing document URIs, with or without a MIME
/// type. The provider's display name is still validated before reading a file.
pub fn intent_filters() -> String {
    let mut filters = String::new();
    for typed in [true, false] {
        filters.push_str(
            r#"<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="content" />
    <data android:scheme="file" />
    <data android:host="*" />
    <data android:host="" />
"#,
        );
        if typed {
            // Providers disagree on Typst's MIME type. The URI suffix, rather
            // than this MIME wildcard, restricts the files we advertise for.
            filters.push_str("    <data android:mimeType=\"*/*\" />\n");
        }
        for extension in ["typ", "tyP", "tYp", "tYP", "Typ", "TyP", "TYp", "TYP"] {
            // Android 12+ can match a suffix directly, including paths with any
            // number of dots. Older Android versions ignore pathSuffix.
            filters.push_str(&format!(
                "    <data android:pathSuffix=\".{extension}\" />\n"
            ));
            // Android's legacy simple glob does not backtrack: .*\\.typ stops
            // at the FIRST dot. Supply alternatives for dotted directories and
            // names too. These remain suffix-constrained on Android 7–11.
            for dots in 1..=32 {
                let prefix = r".*\\.".repeat(dots);
                filters.push_str(&format!(
                    "    <data android:pathPattern=\"{prefix}{extension}\" />\n"
                ));
            }
        }
        filters.push_str("</intent-filter>\n");
    }
    filters
}
