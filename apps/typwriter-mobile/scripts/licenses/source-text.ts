import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class SourceHttpError extends Error {
  constructor(url: string, public status: number) { super(`${url}: HTTP ${status}`); }
}

/** Cache public upstream metadata so interrupted generation can resume. */
export async function sourceText(url: string): Promise<string> {
  const file = Bun.file(join(tmpdir(), "typwriter-license-texts", createHash("sha256").update(url).digest("hex")));
  if (await file.exists()) return file.text();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new SourceHttpError(url, response.status);
      const text = await response.text();
      await Bun.write(file, text);
      return text;
    } catch (error) {
      if (error instanceof SourceHttpError && error.status < 500) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
