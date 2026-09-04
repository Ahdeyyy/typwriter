// Adapted from `typst-cli/src/init.rs` in the Typst repository
// https://github.com/typst/typst/blob/main/crates/typst-cli/src/init.rs
//
// Copyright 2023-2024 Typst GmbH
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use fs_extra::dir::CopyOptions;
use log::info;
use serde::Serialize;
use tauri::{AppHandle, State};
use typst::syntax::package::{
    PackageManifest, PackageSpec, TemplateInfo, VersionlessPackageSpec,
};

use crate::workspace::store;
use crate::world::EditorWorld;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitWorkspaceResult {
    pub workspace_path: String,
    pub entrypoint: String,
}

/// Execute package initialization into a new workspace.
///
/// Obtains the package (downloading if needed), extracts the template files into
/// `parent_path/name`, initializes Typwriter workspace metadata, sets the template's
/// entrypoint as the workspace main file, and pre-populates open tabs so the entrypoint
/// opens immediately.
#[tauri::command(async)]
pub fn init_package_workspace(
    app_handle: AppHandle,
    world: State<'_, Arc<EditorWorld>>,
    parent_path: String,
    name: String,
    template: String,
) -> Result<InitWorkspaceResult, String> {
    let t = Instant::now();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Workspace name must not be empty".into());
    }

    let template_str = template.trim();
    if template_str.is_empty() {
        return Err("Template must not be empty".into());
    }

    let workspace_path = PathBuf::from(&parent_path).join(&name);
    if workspace_path.exists() {
        return Err(format!(
            "Project directory already exists (at {})",
            workspace_path.display()
        ));
    }

    let packages = world.package_storage();

    // Parse the package specification. If the user didn't specify the version,
    // we try to figure it out automatically by looking up the latest version.
    let spec: PackageSpec = template_str.parse().or_else(|err| {
        let spec: VersionlessPackageSpec = template_str.parse().map_err(|_| err)?;
        let version = packages
            .latest_version(&spec)
            .map_err(|e| format!("{e}"))?;
        Ok::<_, String>(spec.at(version))
    }).map_err(|e| format!("Invalid package specification: {e}"))?;

    // Find or download the package.
    let root = packages
        .obtain(&spec)
        .map_err(|err| format!("Failed to obtain package {spec}: {err}"))?;
    let package_path = root.path();

    // Parse the manifest.
    let manifest = parse_manifest(package_path)?;
    manifest
        .validate(&spec)
        .map_err(|err| format!("Invalid package manifest: {err}"))?;

    // Ensure that it is indeed a template.
    let Some(template_info) = &manifest.template else {
        return Err(format!("Package {spec} is not a template"));
    };

    // Set up the project directory and copy template contents.
    scaffold_project(&workspace_path, package_path, template_info)?;

    // Create .typwriter metadata directory and workspace.json
    let meta_path = workspace_path.join(".typwriter");
    fs::create_dir_all(&meta_path)
        .map_err(|e| format!("Failed to create .typwriter directory: {e}"))?;

    let now = chrono::Utc::now().to_rfc3339();
    let meta_json = serde_json::json!({
        "name": name,
        "created_at": now,
        "version": "1"
    });
    let meta_file = meta_path.join("workspace.json");
    fs::write(&meta_file, meta_json.to_string())
        .map_err(|e| format!("Failed to write workspace.json: {e}"))?;

    // Normalize entrypoint path (relative forward-slash for frontend and stores)
    let entrypoint_rel = template_info
        .entrypoint
        .to_string()
        .replace('\\', "/");
    let entrypoint_abs = workspace_path.join(Path::new(&entrypoint_rel));

    // Register as main file and open tab so the editor activates it on launch
    store::set_workspace_main_file(&app_handle, &workspace_path, &entrypoint_abs);
    store::save_workspace_tabs(
        &app_handle,
        &workspace_path,
        vec![entrypoint_rel.clone()],
        Some(entrypoint_rel.clone()),
        HashMap::new(),
        Some(0),
    );

    let path_str = workspace_path.to_string_lossy().into_owned();
    info!(
        "init_package_workspace: ok path={path_str:?} entrypoint={entrypoint_rel:?} ({:.1}ms)",
        t.elapsed().as_secs_f64() * 1000.0
    );

    Ok(InitWorkspaceResult {
        workspace_path: path_str,
        entrypoint: entrypoint_rel,
    })
}

/// Parses the manifest of the package located at `package_path`.
fn parse_manifest(package_path: &Path) -> Result<PackageManifest, String> {
    let toml_path = package_path.join("typst.toml");
    let string = fs::read_to_string(&toml_path).map_err(|err| {
        format!(
            "Failed to read package manifest ({}): {err}",
            toml_path.display()
        )
    })?;

    toml::from_str(&string)
        .map_err(|err| format!("Package manifest is malformed: {err}"))
}

/// Creates the project directory with the template's contents.
fn scaffold_project(
    project_dir: &Path,
    package_path: &Path,
    template: &TemplateInfo,
) -> Result<(), String> {
    let template_dir = package_path.join(template.path.as_str());
    if !template_dir.exists() {
        return Err(format!(
            "Template directory does not exist (at {})",
            template_dir.display()
        ));
    }

    fs::create_dir_all(project_dir)
        .map_err(|err| format!("Failed to create project directory: {err}"))?;

    fs_extra::dir::copy(
        &template_dir,
        project_dir,
        &CopyOptions::new().content_only(true),
    )
    .map_err(|err| format!("Failed to copy template contents: {err}"))?;

    Ok(())
}
