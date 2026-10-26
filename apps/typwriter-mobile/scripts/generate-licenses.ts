// Generate notices only for dependencies declared by the mobile app itself.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, readFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crateNotices, registryDirectories, type RustPackage } from "./licenses/collect-rust";
import { sourceText } from "./licenses/source-text";

type Package = { name: string; version: string; ecosystem: string; license: string;
  notices: { title: string; text: string }[] };
type CargoDependency = string | { package?: string };
interface DependencyTables {
  dependencies?: Record<string, CargoDependency>;
  "build-dependencies"?: Record<string, CargoDependency>;
  "dev-dependencies"?: Record<string, CargoDependency>;
}
interface CargoManifest extends DependencyTables {
  package: { name: string };
  target?: Record<string, DependencyTables>;
}

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "../..");
const output = join(app, "src/lib/licenses/catalog.json");
const inputs = ["package.json", "bun.lock", "apps/typwriter-mobile/package.json",
  "apps/typwriter-mobile/src-tauri/Cargo.toml", "apps/typwriter-mobile/src-tauri/Cargo.lock",
  "apps/typwriter-mobile/scripts/generate-licenses.ts", "apps/typwriter-mobile/scripts/licenses/collect-rust.ts",
  "apps/typwriter-mobile/scripts/licenses/source-text.ts"];
const fingerprint = createHash("sha256");
for (const input of inputs) fingerprint.update(input).update(readFileSync(join(root, input), "utf8").replace(/\r\n/g, "\n"));
const inputHash = fingerprint.digest("hex");

function packageDirectory(name: string): string {
  for (let directory = app; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (directory === dirname(directory)) throw new Error(`Install frontend dependencies first: ${name}`);
  }
}
const manifest = await Bun.file(join(app, "package.json")).json();
const directNpm = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies })
  .sort().map(name => {
    const directory = packageDirectory(name);
    const meta = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    return { directory, meta };
  });

const cargo = Bun.TOML.parse(await Bun.file(join(app, "src-tauri/Cargo.toml")).text()) as unknown as CargoManifest;
const lock = Bun.TOML.parse(await Bun.file(join(app, "src-tauri/Cargo.lock")).text()) as {
  package: (RustPackage & { dependencies?: string[] })[];
};
const directCrateNames = new Set<string>();
for (const config of [cargo, ...Object.values(cargo.target ?? {})]) {
  for (const table of [config.dependencies, config["build-dependencies"], config["dev-dependencies"]]) {
    for (const [name, dependency] of Object.entries(table ?? {})) {
      directCrateNames.add(typeof dependency === "string" ? name : dependency.package ?? name);
    }
  }
}
const appPackage = lock.package.find(pkg => pkg.name === cargo.package.name && !pkg.source);
if (!appPackage) throw new Error("Mobile app is missing from Cargo.lock");
const directRust: RustPackage[] = [];
for (const name of [...directCrateNames].sort()) {
  // The app's lockfile entry identifies exact direct versions, including when
  // another dependency pulls in an older version of the same crate.
  const references = appPackage.dependencies?.filter(ref => ref.split(" ")[0] === name) ?? [];
  if (!references.length) throw new Error(`Missing direct Rust dependency in Cargo.lock: ${name}`);
  for (const reference of references) {
    const [, version] = reference.split(" ");
    const candidates = lock.package.filter(pkg => pkg.name === name && (!version || pkg.version === version));
    if (candidates.length !== 1) throw new Error(`Ambiguous locked direct dependency: ${reference}`);
    directRust.push(candidates[0]!);
  }
}

const packageId = (pkg: Pick<Package, "ecosystem" | "name" | "version">) => `${pkg.ecosystem}/${pkg.name}/${pkg.version}`;
const expectedIds = new Set([
  ...directNpm.map(({ meta }) => packageId({ ecosystem: "JavaScript", name: meta.name, version: meta.version })),
  ...directRust.map(pkg => packageId({ ...pkg, ecosystem: "Rust" })),
]);
if (process.argv.includes("--check")) {
  const catalog = await Bun.file(output).json();
  if (catalog.inputHash !== inputHash) throw new Error("Mobile licenses are stale. Run bun run licenses:generate.");
  const actualIds = new Set<string>();
  for (const pkg of catalog.packages as Package[]) {
    const id = packageId(pkg);
    if (!expectedIds.has(id) || actualIds.has(id)) throw new Error(`Unexpected dependency notice: ${id}`);
    actualIds.add(id);
    if (!pkg.license || !pkg.notices.length || pkg.notices.some(n => !catalog.texts[n.text])) {
      throw new Error(`Incomplete license notice: ${pkg.name} ${pkg.version}`);
    }
  }
  for (const id of expectedIds) if (!actualIds.has(id)) throw new Error(`Missing direct dependency notice: ${id}`);
  console.log(`Verified ${actualIds.size} direct mobile dependency notices.`);
  process.exit(0);
}

const packages: Package[] = [];
const texts: Record<string, string> = {};
function notice(title: string, source: string) {
  const text = source.replace(/\r\n/g, "\n").trim();
  const id = createHash("sha256").update(text).digest("hex").slice(0, 16);
  texts[id] = text;
  return { title, text: id };
}
function licenseFiles(directory: string, base = directory): { title: string; text: string }[] {
  const notices: { title: string; text: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "target"].includes(entry.name)) {
      notices.push(...licenseFiles(path, base));
    } else if (entry.isFile() && /^(licen[cs]e|notice|copying|copyright|ofl)([._-]|$)/i.test(entry.name)
      && !/\.(rs|js|ts|json|toml|html|py|h|c)$/i.test(entry.name)) {
      notices.push(notice(relative(base, path).replaceAll("\\", "/"), readFileSync(path, "utf8")));
    }
  }
  return notices;
}
async function fallbackNotices(license: string, attribution = "") {
  const notices = attribution ? [notice("Publisher attribution", attribution)] : [];
  for (const id of license.split(/\s+(?:OR|AND|WITH)\s+|\s*\/\s*/).map(id => id.replace(/[()]/g, "").trim())) {
    notices.push(notice(id, await sourceText(`https://raw.githubusercontent.com/spdx/license-list-data/main/text/${id}.txt`)));
  }
  return notices;
}
async function addPackage(pkg: Omit<Package, "notices">, directory: string, attribution = "") {
  let notices = licenseFiles(directory);
  if (!pkg.license && notices.length) {
    const text = notices.map(n => texts[n.text]).join("\n");
    pkg.license = /Permission is hereby granted, free of charge/i.test(text) ? "MIT"
      : /Apache License/i.test(text) ? "Apache-2.0" : "License file";
  }
  if (!pkg.license) throw new Error(`Missing license declaration: ${pkg.name} ${pkg.version}`);
  if (!notices.length) notices = await fallbackNotices(pkg.license, attribution);
  packages.push({ ...pkg, notices });
}

for (const { directory, meta } of directNpm) {
  const license = typeof meta.license === "string" ? meta.license : meta.license?.type
    ?? meta.licenses?.map((item: { type: string }) => item.type).join(" OR ");
  await addPackage({ name: meta.name, version: meta.version, ecosystem: "JavaScript", license }, directory,
    [meta.author, ...(meta.contributors ?? [])].filter(Boolean).map((person: string | { name: string }) => typeof person === "string" ? person : person.name).join("\n"));
}
const registries = registryDirectories();
for (const pkg of directRust) {
  if (!pkg.source?.startsWith("registry+")) throw new Error(`Add license collection for ${pkg.name}: ${pkg.source}`);
  const directory = registries.map(registry => join(registry, `${pkg.name}-${pkg.version}`)).find(path => existsSync(join(path, "Cargo.toml")));
  if (directory) {
    const meta = Bun.TOML.parse(await Bun.file(join(directory, "Cargo.toml")).text()) as { package: { license?: string; authors?: string[] } };
    await addPackage({ name: pkg.name, version: pkg.version, ecosystem: "Rust", license: meta.package.license ?? "License file" }, directory, meta.package.authors?.join("\n"));
  } else {
    const source = await crateNotices(pkg);
    let notices = Object.entries(source.files).map(([title, text]) => notice(title, text));
    if (!notices.length) notices = await fallbackNotices(source.license, source.authors.join("\n"));
    packages.push({ name: pkg.name, version: pkg.version, ecosystem: "Rust", license: source.license, notices });
  }
}
const unique = [...new Map(packages.map(pkg => [packageId(pkg), pkg])).values()];
unique.sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en") || a.ecosystem.localeCompare(b.ecosystem, "en"));
await Bun.write(output, JSON.stringify({ inputHash, packages: unique, texts }, null, 2) + "\n");
console.log(`Wrote ${unique.length} direct dependencies and ${Object.keys(texts).length} license/notice texts.`);
