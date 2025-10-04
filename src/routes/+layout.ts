// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
export const ssr = false;
export const csr = true;


// on load initialize the app state
// get recently opened workspaces and open the most recent

// export const load: LayoutLoad = async () => {
//     const recent = new RuneStore('recent_workspaces', { workspaces: [] as string[] }, {
//         saveOnChange: true,
//         autoStart: true,
//     });

//     app.recentWorkspaces = recent.state.workspaces;
//     if (app.recentWorkspaces.length > 0) {
//         app.workspacePath = app.recentWorkspaces[0];
//         const open_files = new RuneStore(`open_files_${app.workspacePath}`, { files: [] as string[] }, {
//             saveOnChange: true,
//             autoStart: true,
//         });

//         app.currentFilePath = open_files.state.files.length > 0 ? open_files.state.files[0] : "";
//         if (app.currentFilePath !== "") {
//             const fileContent = await readTextFile(app.currentFilePath)
//             return { fileContent }
//         }

//     }
//     return {};
// };

