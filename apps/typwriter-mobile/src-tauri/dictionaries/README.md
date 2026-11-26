# Bundled spelling dictionary

`en_US/` is the fallback dictionary for spell checking (`src/spell.rs`), used
only when the device has no spellchecker service of its own. It is the SCOWL
en_US Hunspell dictionary as packaged by `dictionary-en` 4.0.0
(<https://github.com/wooorm/dictionaries/tree/main/dictionaries/en>),
`index.aff` / `index.dic` renamed. `LICENSE` is that package's license file;
`scripts/generate-licenses.ts` carries it into the in-app notices.
