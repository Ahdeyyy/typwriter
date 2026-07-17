import type { Extension } from "@codemirror/state"
import {
  Language,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from "@codemirror/language"

// ── Lezer-based language packages (first-party @codemirror/lang-*) ──────────
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { php } from "@codemirror/lang-php"
import { cpp } from "@codemirror/lang-cpp"
import { java } from "@codemirror/lang-java"
import { rust } from "@codemirror/lang-rust"
import { go } from "@codemirror/lang-go"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"
import { json } from "@codemirror/lang-json"
import { xml } from "@codemirror/lang-xml"
import { yaml } from "@codemirror/lang-yaml"
import { vue } from "@codemirror/lang-vue"
import { sass } from "@codemirror/lang-sass"
import { less } from "@codemirror/lang-less"
import { markdown } from "@codemirror/lang-markdown"
import {
  sql,
  MySQL,
  MariaSQL,
  PostgreSQL,
  SQLite,
  MSSQL,
  Cassandra,
  PLSQL,
} from "@codemirror/lang-sql"

// ── Stream-parser modes (@codemirror/legacy-modes) ──────────────────────────
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { powerShell } from "@codemirror/legacy-modes/mode/powershell"
import { toml } from "@codemirror/legacy-modes/mode/toml"
import { lua } from "@codemirror/legacy-modes/mode/lua"
import { perl } from "@codemirror/legacy-modes/mode/perl"
import { ruby } from "@codemirror/legacy-modes/mode/ruby"
import { swift } from "@codemirror/legacy-modes/mode/swift"
import {
  csharp,
  kotlin,
  scala,
  dart,
  objectiveC,
  objectiveCpp,
} from "@codemirror/legacy-modes/mode/clike"
import { haskell } from "@codemirror/legacy-modes/mode/haskell"
import { oCaml, fSharp, sml } from "@codemirror/legacy-modes/mode/mllike"
import { clojure } from "@codemirror/legacy-modes/mode/clojure"
import { erlang } from "@codemirror/legacy-modes/mode/erlang"
import { elm } from "@codemirror/legacy-modes/mode/elm"
import { julia } from "@codemirror/legacy-modes/mode/julia"
import { r } from "@codemirror/legacy-modes/mode/r"
import { fortran } from "@codemirror/legacy-modes/mode/fortran"
import { pascal } from "@codemirror/legacy-modes/mode/pascal"
import { crystal } from "@codemirror/legacy-modes/mode/crystal"
import { d } from "@codemirror/legacy-modes/mode/d"
import { diff } from "@codemirror/legacy-modes/mode/diff"
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile"
import { cmake } from "@codemirror/legacy-modes/mode/cmake"
import { groovy } from "@codemirror/legacy-modes/mode/groovy"
import { nginx } from "@codemirror/legacy-modes/mode/nginx"
import { properties } from "@codemirror/legacy-modes/mode/properties"
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf"
import { octave } from "@codemirror/legacy-modes/mode/octave"
import { scheme } from "@codemirror/legacy-modes/mode/scheme"
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp"
import { smalltalk } from "@codemirror/legacy-modes/mode/smalltalk"
import { stylus } from "@codemirror/legacy-modes/mode/stylus"
import { tcl } from "@codemirror/legacy-modes/mode/tcl"
import { verilog } from "@codemirror/legacy-modes/mode/verilog"
import { vhdl } from "@codemirror/legacy-modes/mode/vhdl"
import { vb } from "@codemirror/legacy-modes/mode/vb"
import { vbScript } from "@codemirror/legacy-modes/mode/vbscript"
import { stex } from "@codemirror/legacy-modes/mode/stex"
import { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript"
import { jinja2 } from "@codemirror/legacy-modes/mode/jinja2"
import { pug } from "@codemirror/legacy-modes/mode/pug"
import { gas } from "@codemirror/legacy-modes/mode/gas"

/// Language extensions for the editor and nested code blocks, assembled from
/// the individual first-party packages: `@codemirror/lang-*` where a Lezer
/// grammar exists, `@codemirror/legacy-modes` stream parsers for the rest.
/// Each entry lists every fence tag / file extension that resolves to it, so
/// both ```` ```rust ```` and a `.rs` file hit the same factory.

type Factory = () => Extension

function legacy(parser: StreamParser<unknown>): Factory {
  return () => StreamLanguage.define(parser)
}

const LANGUAGES: [Factory, string[]][] = [
  // Lezer grammars
  [() => javascript(), ["js", "javascript", "mjs", "cjs", "node"]],
  [() => javascript({ jsx: true }), ["jsx"]],
  [() => javascript({ typescript: true }), ["ts", "typescript", "mts", "cts"]],
  [() => javascript({ typescript: true, jsx: true }), ["tsx"]],
  [() => python(), ["py", "python", "pyw"]],
  [() => php(), ["php", "php3", "php4", "php5", "php7", "phtml"]],
  [
    () => cpp(),
    ["cpp", "c", "h", "hpp", "cc", "hh", "cxx", "hxx", "c++", "cplusplus", "ino"],
  ],
  [() => java(), ["java"]],
  [() => rust(), ["rs", "rust"]],
  [() => go(), ["go", "golang"]],
  // .svelte gets the HTML grammar as a best-effort approximation (script/style
  // blocks highlight correctly; template syntax stays plain).
  [() => html(), ["html", "htm", "xhtml", "markup", "svelte"]],
  [() => css(), ["css"]],
  [() => sass(), ["scss"]],
  [() => sass({ indented: true }), ["sass"]],
  [() => less(), ["less"]],
  [() => json(), ["json", "jsonc", "json5", "jsonld"]],
  [() => xml(), ["xml", "xsd", "xsl", "xslt", "plist", "rss", "svg"]],
  [() => yaml(), ["yaml", "yml"]],
  [() => vue(), ["vue"]],
  [() => markdown(), ["md", "markdown", "mkd"]],
  [() => sql(), ["sql"]],
  [() => sql({ dialect: MySQL }), ["mysql"]],
  [() => sql({ dialect: MariaSQL }), ["mariadb"]],
  [() => sql({ dialect: PostgreSQL }), ["pgsql", "postgres", "postgresql"]],
  [() => sql({ dialect: SQLite }), ["sqlite"]],
  [() => sql({ dialect: MSSQL }), ["mssql", "tsql"]],
  [() => sql({ dialect: Cassandra }), ["cql", "cassandra"]],
  [() => sql({ dialect: PLSQL }), ["plsql"]],

  // Stream-parser modes
  [
    legacy(shell),
    ["sh", "bash", "zsh", "fish", "shell", "console", "shellsession"],
  ],
  [legacy(powerShell), ["ps1", "psm1", "psd1", "powershell", "pwsh"]],
  [legacy(toml), ["toml"]],
  [legacy(lua), ["lua"]],
  [legacy(perl), ["pl", "pm", "perl"]],
  [legacy(ruby), ["rb", "ruby"]],
  [legacy(swift), ["swift"]],
  [legacy(csharp), ["cs", "csharp", "c#"]],
  [legacy(kotlin), ["kt", "kts", "kotlin"]],
  [legacy(scala), ["scala", "sc"]],
  [legacy(dart), ["dart"]],
  [legacy(objectiveC), ["objectivec", "objective-c", "objc"]],
  [legacy(objectiveCpp), ["mm", "objective-c++", "objectivecpp"]],
  [legacy(haskell), ["hs", "haskell"]],
  [legacy(oCaml), ["ml", "mli", "ocaml"]],
  [legacy(fSharp), ["fs", "fsx", "fsi", "fsharp", "f#"]],
  [legacy(sml), ["sml"]],
  [
    legacy(clojure),
    ["clj", "cljs", "cljc", "edn", "clojure", "clojurescript"],
  ],
  [legacy(erlang), ["erl", "hrl", "erlang"]],
  [legacy(elm), ["elm"]],
  [legacy(julia), ["jl", "julia"]],
  [legacy(r), ["r"]],
  [legacy(fortran), ["f", "f77", "f90", "f95", "for", "fortran"]],
  [legacy(pascal), ["pas", "pascal"]],
  [legacy(crystal), ["cr", "crystal"]],
  [legacy(d), ["d", "dlang"]],
  [legacy(diff), ["diff", "patch"]],
  [legacy(dockerFile), ["dockerfile", "docker", "containerfile"]],
  [legacy(cmake), ["cmake"]],
  [legacy(groovy), ["groovy", "gradle"]],
  [legacy(nginx), ["nginx"]],
  [
    legacy(properties),
    ["properties", "ini", "cfg", "conf", "env", "dotenv", "editorconfig"],
  ],
  [legacy(protobuf), ["proto", "protobuf"]],
  [legacy(octave), ["m", "octave", "matlab"]],
  [legacy(scheme), ["scm", "ss", "scheme", "racket", "rkt"]],
  [
    legacy(commonLisp),
    ["lisp", "cl", "commonlisp", "common-lisp", "el", "elisp", "emacs-lisp"],
  ],
  [legacy(smalltalk), ["st", "smalltalk"]],
  [legacy(stylus), ["styl", "stylus"]],
  [legacy(tcl), ["tcl"]],
  [legacy(verilog), ["v", "sv", "svh", "verilog", "systemverilog"]],
  [legacy(vhdl), ["vhd", "vhdl"]],
  [legacy(vb), ["vb", "visualbasic", "visual-basic", "vbnet", "vb.net"]],
  [legacy(vbScript), ["vbs", "vbscript"]],
  [legacy(stex), ["tex", "latex", "sty", "cls", "bib"]],
  [legacy(coffeeScript), ["coffee", "coffeescript"]],
  [legacy(jinja2), ["jinja", "jinja2", "j2"]],
  [legacy(pug), ["pug", "jade"]],
  [legacy(gas), ["s", "asm", "assembly", "gas"]],
]

const TABLE = new Map<string, Factory>()
for (const [factory, keys] of LANGUAGES) {
  for (const key of keys) TABLE.set(key, factory)
}

/// Tags / extensions that mean "no highlighting" — kept explicit so plain-text
/// formats never accidentally pick up a language mode.
const PLAIN_TAGS = new Set([
  "text",
  "plaintext",
  "plain",
  "txt",
  "log",
  "csv",
  "tsv",
])

/// Resolve a language tag / file extension to its factory.
/// Returns `null` for unknown or plain-text tags.
function langFactory(tag: string): Factory | null {
  const key = tag.trim().toLowerCase()
  if (!key || PLAIN_TAGS.has(key)) return null
  return TABLE.get(key) ?? null
}

/// Build the language extension (`LanguageSupport` / `StreamLanguage`) for a
/// tag or file extension. Used for the editor's active file. Returns `null`
/// when no matching language exists.
export function langExtension(tag: string): Extension | null {
  const factory = langFactory(tag)
  return factory ? factory() : null
}

/// Build the language extension for a file path, keyed on its extension.
/// `.typ` / `.md` are handled separately by their own language support (they
/// also enable nested code-block highlighting), so they resolve to `null` here.
export function langExtensionForPath(relPath: string): Extension | null {
  const dot = relPath.lastIndexOf(".")
  if (dot < 0) return null
  const ext = relPath.slice(dot + 1).toLowerCase()
  if (ext === "typ" || ext === "md" || ext === "markdown") return null
  return langExtension(ext)
}

/// Fence-tag overrides that differ from the file-extension mapping. A ```php
/// fence is almost always bare PHP without an `<?php` open tag; the default
/// grammar treats such input as HTML text (no highlighting), so fences parse
/// in `plain` mode. Real `.php` files keep the default HTML-embedded grammar.
const FENCE_OVERRIDES = new Map<string, Factory>([
  ["php", () => php({ plain: true })],
])

/// Resolve a raw-block language tag to a `Language` for nested parsing inside
/// Typst / Markdown code fences. Pass this as `codeLanguages` to `typst()` /
/// `markdown()`. Returns `null` when the tag is unknown.
export function resolveCodeLanguage(info: string): Language | null {
  const override = FENCE_OVERRIDES.get(info.trim().toLowerCase())
  const support = override ? override() : langExtension(info)
  if (support instanceof LanguageSupport) return support.language
  if (support instanceof Language) return support
  return null
}
