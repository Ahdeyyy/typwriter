# Linux symbols and file-manager integration

## Findings

The reported picker screenshot has `1 of 131` matches but no result area. The
picker used a zero flex basis (`flex-1`) for its scrollable body inside a
content-sized dialog with only a maximum height. Restoring that layout in
WebKitGTK 2.50.4 on Ubuntu 22.04 reproduces the collapse: the results body is
only **8 pixels** high and the whole dialog is 83 pixels high. The fix uses `flex-auto` (a content
basis), removes the unnecessary `height: fit-content`, and prevents the search
and footer from shrinking. The dialog still sizes to its results and scrolls
when it reaches 70% of the viewport height. This follows the
[flexbox sizing rules](https://www.w3.org/TR/css-flexbox-1/#flex-common).

Linux file opening had two independent packaging gaps:

- Tauri CLI **2.11.4**, pinned in `bun.lock`, generates `Exec=typwriter` without
  a file placeholder. Advertising a MIME type alone does not pass a selected
  file to the executable. Our desktop template uses `Exec=typwriter %F`, which
  passes each selected local file as a separate argument, preserving spaces
  and Unicode. See the [pinned Tauri template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/linux/freedesktop/main.desktop)
  and [desktop-entry argument specification](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html).
- `fileAssociations.mimeType` adds a desktop-entry capability; it does not
  install a shared MIME definition mapping `*.typ` to that type. Older Linux
  MIME databases can lack Typst entirely or recognize its older `text/x-typst`
  name. All three Linux formats now ship an XML definition at
  `/usr/share/mime/packages/com.ahdey.typwriter.xml`, with the registered
  `text/vnd.typst` type, a `text/plain` parent, and the legacy alias. The launcher
  advertises both names. See [Typst's MIME registration](https://www.iana.org/assignments/media-types/text/vnd.typst),
  [Typst's upstream report about the old name](https://github.com/typst/typst/issues/6174),
  and the [shared MIME specification](https://specifications.freedesktop.org/shared-mime-info-spec/latest/ar01s02.html).

DEB and RPM depend on `shared-mime-info` and `desktop-file-utils` and refresh
both databases after installation and removal. The hooks also cover upgrades.
They do not change a user's preferred editor or claim all plain text files.
Tauri appends its normal WebKit/GTK dependencies to these configured ones.

The AppImage bundler reuses the DEB desktop template, but has its own `files`
map. Its MIME XML must therefore be included separately in that map. See the
[pinned AppImage bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs).

The existing Rust startup/single-instance queue already accepts file paths and
file URLs and delivers them to the standalone-document flow. No workspace or
file-open protocol changes are needed.

## Using the fixed build on Pop!_OS

Install the newly built `.deb` with the distribution's package installer, or:

```sh
sudo apt install ./Typwriter_<version>_amd64.deb
```

Typwriter should then appear in the file manager's **Open With** choices for
`.typ` files. To make double-click use Typwriter, choose it as the default in
the file's properties, or run these commands as your normal user:

```sh
xdg-mime default Typwriter.desktop text/vnd.typst
xdg-mime default Typwriter.desktop text/x-typst
```

For AppImage, integrate the **new** image with a tool such as AppImageLauncher
or appimaged, then choose its registered launcher as the default in the file
manager. Re-integrate an image registered before this fix to replace its old
launcher. Simply executing an AppImage does not install its desktop entry or
MIME XML into the host. Its registration library imports the bundled desktop
entry, icons and MIME packages into the user's XDG data directory. See the
[AppImage integration guide](https://docs.appimage.org/user-guide/run-appimages.html#integrating-appimages-into-the-desktop)
and [integration library reference](https://docs.appimage.org/api/libappimage/api/classappimage_1_1desktop__integration_1_1IntegrationManager.html).

## Verification

`tests/linux-integration/check.py` validates all package mappings and tests the
desktop entry with actual Linux MIME/GIO tools in a temporary XDG environment.
It checks canonical and legacy handler discovery, upper/lowercase extensions,
and delivery of multiple filenames containing spaces and Unicode. CI runs it
on Ubuntu 22.04. `--metadata-only` runs the configuration checks on other OSes.
The test renders our template with Tauri's documented parameter values; it
does not build or install the full release packages.

The [symbol picker harness](../tests/symbol-picker-preview/README.md) exercises
the production picker with real CodeMirror. Its Python runner checks a real
system WebKitGTK 4.1 webview under Xvfb; CI runs it on Ubuntu 22.04. Before
release, also test the installed Linux app: open a `.typ` file while Typwriter is closed, repeat while
it is running, and confirm both arrive as standalone documents. Test the newly
integrated AppImage separately. Check the picker in the system WebKitGTK
webview; Chromium passing alone cannot confirm a WebKit-specific layout fix.

Local validation passed: all ten picker checks in WebKitGTK 2.50.4 on Ubuntu
22.04, Linux MIME/GIO checks, 531 desktop unit tests, Svelte type checking,
targeted ESLint, and the production frontend build. The build reports an
existing unrelated scrollbar-selector optimization warning. These checks do
not replace installing the complete release packages on Pop!_OS.
