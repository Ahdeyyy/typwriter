fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        // MIME filters (even */*) reject intents with no MIME type. Some file
        // managers send unknown extensions this way. Do not restrict the URI
        // path: content providers can use opaque IDs, and file:/// has no host.
        // document::validate_name checks the provider's actual filename.
        tauri_utils::build::update_android_manifest(
            "typwriter-untyped-documents",
            "activity",
            r#"<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="content" />
    <data android:scheme="file" />
</intent-filter>"#
                .into(),
        )
        .expect("failed to register Android document intents without a MIME type");
    }
}
