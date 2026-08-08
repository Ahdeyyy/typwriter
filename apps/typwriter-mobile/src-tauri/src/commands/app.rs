// App-level metadata commands (nothing workspace- or document-specific).

/// The version of the Typst compiler this build links against.
///
/// Read from the compiler itself — the same value documents see as
/// `sys.version` — rather than hardcoded on either side, so bumping the `typst`
/// dependency updates the settings sheet with no other edit.
#[tauri::command]
pub async fn get_typst_version() -> String {
    typst::utils::version().raw().to_string()
}
