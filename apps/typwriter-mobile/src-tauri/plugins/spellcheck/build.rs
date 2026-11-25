// No JS-facing commands: the app's own `spell_check` command calls this
// plugin from Rust (which the capability ACL doesn't gate) and falls back to
// its bundled dictionary when the device has no spellchecker service.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
