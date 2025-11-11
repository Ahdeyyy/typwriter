# CodeMirror Compartments Implementation Guide

## Overview

This project now uses **CodeMirror Compartments** to dynamically switch language extensions without recreating the entire editor instance. This provides a more efficient and seamless experience when switching between different file types.

## What are Compartments?

Compartments are a CodeMirror feature that allows you to dynamically reconfigure specific parts of the editor's extensions without rebuilding the entire editor state. Think of them as "slots" in the editor configuration that can be swapped out on the fly.

## Implementation Details

### Architecture

The implementation consists of two main components:

1. **`codemirror.svelte`** - Base editor component with compartment support
2. **`editor.svelte`** - High-level component that configures language-specific extensions

### Key Changes

#### 1. Compartments in `codemirror.svelte`

We created two compartments:
- `languageCompartment` - For language-specific syntax (Typst, YAML, BibTeX, etc.)
- `extensionsCompartment` - For all other extensions (linters, hover tooltips, etc.)

```typescript
const languageCompartment = new Compartment();
const extensionsCompartment = new Compartment();
```

These compartments are initialized in the editor's initial state:

```typescript
const initialExtensions = [
    EditorView.lineWrapping,
    fixedHeight,
    editorWidth,
    updateListener,
    languageCompartment.of(lang || []),
    extensionsCompartment.of(extensions || []),
];
```

#### 2. Dynamic Reconfiguration with `$effect`

Svelte 5's `$effect` runes watch for changes and dispatch reconfiguration effects:

```typescript
// Update language when it changes
$effect(() => {
    if (view && lang !== undefined) {
        view.dispatch({
            effects: languageCompartment.reconfigure(lang || []),
        });
    }
});

// Update extensions when they change
$effect(() => {
    if (view && extensions) {
        view.dispatch({
            effects: extensionsCompartment.reconfigure(extensions || []),
        });
    }
});
```

#### 3. Removed `{#key}` Block

Previously, the editor was recreated every time the file path changed using Svelte's `{#key}` block:

```svelte
<!-- OLD APPROACH - Don't use this -->
{#key editorStore.file_path}
    <CodeMirror ... />
{/key}
```

This is no longer needed because compartments allow us to reconfigure the editor in place.

### Language-Specific Extension Loading

The `editor.svelte` component determines which extensions to load based on file type:

```typescript
const editorLanguage = $derived.by(() => {
    const path = documentExtension.path;
    if (documentExtension.ext === "typ") {
        return typst();
    } else if (documentExtension.ext === "yaml" || documentExtension.ext === "yml") {
        return yaml();
    } else if (documentExtension.ext === "bib") {
        return bibtex();
    }
    return undefined;
});
```

Language-specific features (like hover tooltips and linters) are conditionally added:

```typescript
let allExtensions = $derived.by(() => {
    const extensions: Extension[] = [
        // Base extensions...
    ];

    switch (documentExtension.ext) {
        case "typ": {
            extensions.push(hoverTooltip(typst_hover_tooltip));
            if (editorStore.file_path === mainSourceStore.file_path) {
                extensions.push(typstLinter(editorStore.diagnostics));
            }
            break;
        }
        // Other cases...
    }

    return extensions;
});
```

## Benefits

1. **Performance** - No editor recreation when switching files
2. **State Preservation** - Undo/redo history can be managed more intelligently
3. **Smooth Transitions** - No visual flicker when switching between files
4. **Memory Efficiency** - Single editor instance instead of recreating on every file change
5. **Better UX** - Faster file switching, especially with large documents

## Supported Languages

Currently, the following language modes are supported:

- **Typst (.typ)** - Full support with syntax highlighting, autocompletion, hover tooltips, and linting
- **YAML (.yaml, .yml)** - Syntax highlighting
- **BibTeX (.bib)** - Syntax highlighting for bibliography files
- **Plain text (.txt, .md)** - Basic text editing
- **JSON (.json)** - Syntax highlighting

## Adding New Languages

To add support for a new language:

1. Import the language package in `editor.svelte`:
   ```typescript
   import { myLanguage } from "@codemirror/lang-mylanguage";
   ```

2. Add the file extension to `editableDocs` if it should be editable:
   ```typescript
   const editableDocs = ["typ", "yaml", "yml", "txt", "md", "json", "bib", "mynewext"];
   ```

3. Add a case in `editorLanguage`:
   ```typescript
   const editorLanguage = $derived.by(() => {
       // ...
       else if (documentExtension.ext === "mynewext") {
           return myLanguage();
       }
       // ...
   });
   ```

4. (Optional) Add language-specific extensions in `allExtensions`:
   ```typescript
   switch (documentExtension.ext) {
       case "mynewext": {
           extensions.push(myLanguageSpecificExtension());
           break;
       }
   }
   ```

## Technical Notes

### Reactivity

The system uses Svelte 5's fine-grained reactivity:
- `$derived.by()` for computed values
- `$effect()` for side effects
- `$bindable()` for two-way binding

### Extension Order

Extensions are applied in this order:
1. Base editor features (line numbers, folding, etc.)
2. Syntax highlighting
3. Autocompletion
4. Keybindings
5. Language-specific extensions
6. Readonly mode (if applicable)

### Performance Considerations

- Extensions are only reconfigured when they actually change
- The `$derived.by()` ensures computed values are only recalculated when dependencies change
- Throttled compilation and rendering (90ms) prevents excessive updates

## Debugging

To debug compartment reconfiguration:

```typescript
$effect(() => {
    console.log("Language changed to:", editorLanguage);
    console.log("Extensions:", allExtensions);
});
```

## Future Improvements

Potential enhancements:
- Add more language modes (Markdown, JavaScript, CSS, etc.)
- Implement custom themes per language
- Add language-specific keybindings
- Implement LSP integration for more languages
- Add collaborative editing support

## References

- [CodeMirror 6 Compartments Documentation](https://codemirror.net/docs/ref/#state.Compartment)
- [Svelte 5 Runes Documentation](https://svelte-5-preview.vercel.app/docs/runes)