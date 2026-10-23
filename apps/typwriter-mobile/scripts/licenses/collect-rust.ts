import { existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface RustPackage {
  name: string;
  version: string;
  source?: string;
}

/** Read the package's original root notices without downloading megabytes of
 * platform binaries or vendored source that are unnecessary for a notice page. */
export async function crateNotices(pkg: RustPackage) {
  const cached = Bun.file(join(tmpdir(), "typwriter-license-crates", `${pkg.name}-${pkg.version}.json`));
  if (await cached.exists()) return cached.json() as Promise<{ license: string; authors: string[]; files: Record<string, string> }>;
  const abort = new AbortController();
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(`https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`, { signal: abort.signal });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  if (!response) throw new Error(`Cannot download ${pkg.name}`);
  if (!response.ok || !response.body) throw new Error(`Cannot read crate notices for ${pkg.name}: ${response.status}`);
  const reader = response.body.pipeThrough(new DecompressionStream("gzip")).getReader();
  let pending = Buffer.alloc(0);
  const files: Record<string, string> = {};
  let manifest: { package: { license?: string; authors?: string[] } } | undefined;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending = Buffer.concat([pending, Buffer.from(chunk.value)]);
      while (pending.length >= 512) {
        const path = pending.toString("utf8", 0, 100).replace(/\0.*$/, "");
        if (!path) break;
        const name = path.split("/").slice(1).join("/");
        // Cargo archives sort root metadata and licenses before source trees.
        if (name.includes("/") && manifest && !/^(licenses?|notices?)\//i.test(name)) {
          abort.abort();
          const result = { license: manifest.package.license ?? "License file", authors: manifest.package.authors ?? [], files };
          await Bun.write(cached, JSON.stringify(result));
          return result;
        }
        const size = parseInt(pending.toString("ascii", 124, 136).replace(/\0.*$/, "").trim() || "0", 8);
        const total = 512 + Math.ceil(size / 512) * 512;
        if (pending.length < total) break;
        const content = pending.toString("utf8", 512, 512 + size);
        if (name === "Cargo.toml") manifest = Bun.TOML.parse(content) as typeof manifest;
        if (/^(licen[cs]e|notice|copying|copyright|ofl)([._-]|$)/i.test(name)) files[name] = content;
        pending = pending.subarray(total);
      }
    }
  } finally {
    abort.abort();
    reader.releaseLock();
  }
  if (!manifest) throw new Error(`Missing Cargo.toml in ${pkg.name} archive`);
  const result = { license: manifest.package.license ?? "License file", authors: manifest.package.authors ?? [], files };
  await Bun.write(cached, JSON.stringify(result));
  return result;
}

export function registryDirectories() {
  const registry = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry/src");
  return existsSync(registry) ? readdirSync(registry).map(name => join(registry, name)) : [];
}
