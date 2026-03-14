# Typwriter

![logo](showcase/app-icon.png)

**Typwriter** is a flexible, modern editor for [Typst](https://typst.app/), built with Tauri and Svelte. It allows you to write Typst documents, see a live preview of the compiled output, and export your documents directly to PDF, SVG and PNG.

## Showcase

### Editor
![Editor](showcase/show%20case%20editor.png)

### Editor Lint
![Editor lint](showcase/show%20case%20editor%20lint.png)

### Preview
![Preview](showcase/show%20case%20-%20preview.png)

### Diagnostics
![Diagnostics](showcase/show%20case%20-%20diagnostic.png)

### Export PDF
![Export PDF](showcase/show%20case%20export%20pdf.png)

### Export PNG
![Export PNG](showcase/show%20case%20export%20png.png)

### Export SVG
![Export SVG](showcase/show%20case%20export%20svg.png)

## Features

I have implemented most of the editor features in the official [web app](https://typst.app/)

  * **Live Preview:** See your compiled output update as you type.
  * **Source-Preview Sync:** The preview automatically scrolls to match your cursor position in the source code.
  * **Click-to-Source:** Click on the preview to jump to the corresponding position in your source file.
  * **Smart Editor:** Get autocomplete suggestions and hover-for-info tooltips.
  * **File Management:** Create new files and folders.
  * **Workspace Management:** View and load recently opened workspaces.
  * **Document Export:** Export your documents to PDF, SVG and PNG.
  
  ## Getting Started (Development)
  
  To run the project locally, follow these steps:
  
  1.  Clone the repository.
  2.  Move to project directory
      ```bash
      cd apps/typwriter-desktop
      ```
  3.  Install the required dependencies:
      ```bash
      bun install
      ```
  4.  Run the Tauri development server:
      ```bash
      bun tauri dev
      ```

  
  ## Tech Stack
  
    * **Core Logic:** [Rust](https://www.rust-lang.org/)
    * **Application Framework:** [Tauri](https://tauri.app/)
    * **Frontend UI:** [Svelte](https://svelte.dev/)
    * **Typesetting Engine:** [Typst](https://typst.app/)
    * **Text Editor:** [CodeMirror](https://codemirror.net/)
