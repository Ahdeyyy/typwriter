// Compile rune modules for Bun's state regression tests. Browser conditions
// select Svelte's client signals; no Tauri process or DOM is needed for stores.
import { plugin, Transpiler } from "bun";
// Resolve from the app running the tests so mobile uses its own Svelte version.
const { compileModule } = await import(Bun.resolveSync("svelte/compiler", process.cwd()));

const transpiler = new Transpiler({ loader: "ts" });

plugin({
  name: "svelte-rune-tests",
  setup(build) {
    build.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
      const source = transpiler.transformSync(await Bun.file(path).text());
      const { js } = compileModule(source, { filename: path, generate: "client" });
      return { contents: js.code, loader: "js" };
    });
  },
});
