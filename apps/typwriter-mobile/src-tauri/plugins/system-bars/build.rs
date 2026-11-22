const COMMANDS: &[&str] = &["set_status_bar_hidden", "set_style", "get_insets"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
