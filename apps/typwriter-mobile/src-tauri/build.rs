mod android_file_associations;

fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        // Own this block: Tauri's generated MIME associations omit scheme/host,
        // so Android ignores their extension patterns and matches every file.
        tauri_utils::build::update_android_manifest(
            "tauri-file-associations",
            "activity",
            android_file_associations::intent_filters(),
        )
        .expect("failed to register Android Typst document intents");

        // Remove the unrestricted MIME-free filter from existing generated
        // projects as well as keeping fresh `android init` builds correct.
        tauri_utils::build::update_android_manifest(
            "typwriter-untyped-documents",
            "activity",
            String::new(),
        )
        .expect("failed to remove legacy Android document intents");
    }
}
