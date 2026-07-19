# Typwriter

![logo](showcase/app-icon.png)

**Typwriter** is a flexible, modern editor for [Typst](https://typst.app/), built with Tauri and Svelte. It allows you to write Typst documents, see a live preview of the compiled output, and export your documents directly to PDF, SVG, PNG and HTML.

Note: Android version is currently buggy and not recommended for real use, I won't focus on it for now.

## Features

I have implemented most of the editor features in the official [web app](https://typst.app/)

- **Live Preview:** See your compiled output update as you type.
- **Source-Preview Sync:** The preview automatically scrolls to match your cursor position in the source code.
- **Click-to-Source:** Click on the preview to jump to the corresponding position in your source file.
- **Smart Editor:** Get autocomplete suggestions and hover-for-info tooltips.
- **File Management:** Create new files and folders.
- **Workspace Management:** View and load recently opened workspaces.
- **Document Export:** Export your documents to PDF, SVG, PNG and HTML.
- **Document Formatting:** Format your document using Typstyle.

  ## Getting Started (Development)

  ### Desktop

  To run the project locally, follow these steps:
  1. Clone the repository.
  2. Move to project directory

     ```bash
     cd apps/typwriter-desktop
     ```

  3. Install the required dependencies:

     ```bash
     bun install
     ```

  4. Run the Tauri development server:

     ```bash
     bun tauri dev
     ```

### Mobile

I haven't been able to build the app natively on windows(the setup is complicated due to the vendored openssl, if you know how to set it up let me know, it will speed up the development of the app), if you are on windows you will need to use WSL2 or a Linux machine to build the app.
I have no idea if it works on MacOS, but it should work.

To run the project locally, follow these steps:

1. Clone the repository.
2. Move to project directory

   ```bash
   cd apps/typwriter-mobile
   ```

3. Install the required dependencies:

   ```bash
   bun install
   ```

4. Run the Tauri development server:

   ```bash
   bun tauri android dev
   ```

## Third Party Libraries

- **Typesetting Engine:** [Typst](https://typst.app/)
- **Text Editor:** [CodeMirror](https://codemirror.net/)
- **Formatter:** [Typstyle](https://github.com/typstyle-rs/typstyle)
