import * as esbuild from "esbuild";

const common = {
  bundle: true,
  target: "chrome120",
  // No eval() — required by MV3 Content Security Policy
  treeShaking: true,
};

const entries = [
  { entryPoints: ["src/background/service-worker.ts"], outfile: "dist/service-worker.js", format: "iife" },
  { entryPoints: ["src/content/content.ts"], outfile: "dist/content.js", format: "iife" },
  { entryPoints: ["src/popup/popup.ts"], outfile: "dist/popup.js", format: "iife" },
];

const watch = process.argv.includes("--watch");

async function build() {
  if (watch) {
    const contexts = await Promise.all(
      entries.map((e) => esbuild.context({ ...common, ...e }))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes…");
  } else {
    await Promise.all(entries.map((e) => esbuild.build({ ...common, ...e })));
    console.log("Build complete → dist/");
  }
}

build().catch((e) => { console.error(e); process.exit(1); });
