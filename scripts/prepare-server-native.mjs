import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, delimiter, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const betterSqliteRoot = dirname(require.resolve("better-sqlite3/package.json"));
const stageRoot = resolve(repoRoot, "dist", "server-native", "build", "better-sqlite3");
const outputDir = resolve(repoRoot, "dist", "server-native");
const outputFile = join(outputDir, "better_sqlite3.node");
const prepareLock = join(outputDir, ".prepare-lock");
// Run node-gyp's JS entrypoint under the current Node directly. Spawning the
// `.bin/node-gyp.cmd` shim on Windows without `shell:true` throws EINVAL since
// the CVE-2024-27980 fix; going through process.execPath is shell-independent
// and cross-platform, so no `.cmd` vs. bare-name branch is needed.
const nodeGypJs = require.resolve("node-gyp/bin/node-gyp.js");

function bindingWorks(path) {
  if (!existsSync(path)) return false;
  const betterSqliteEntry = require.resolve("better-sqlite3");
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      `const Database = require(${JSON.stringify(betterSqliteEntry)}); const db = new Database(":memory:", { nativeBinding: process.env.PORACODE_NATIVE_BINDING_PROBE }); db.close();`,
    ],
    {
      stdio: "ignore",
      env: { ...process.env, PORACODE_NATIVE_BINDING_PROBE: path },
    },
  );
  return probe.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    const reason =
      result.status === null
        ? `spawn error: ${result.error?.message ?? "unknown (status null)"}`
        : `exit code ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed with ${reason}`);
  }
}

function acquirePrepareLock() {
  const startedAt = Date.now();
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      mkdirSync(prepareLock);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (bindingWorks(outputFile)) return false;
      if (Date.now() - startedAt > 10 * 60_000) {
        throw new Error(`Timed out waiting for native binding preparation lock: ${prepareLock}`, {
          cause: error,
        });
      }
      Atomics.wait(sleeper, 0, 0, 250);
    }
  }
}

if (bindingWorks(outputFile)) {
  console.log(`[poracode-server] Node-ABI better-sqlite3 binding is current: ${outputFile}`);
  process.exit(0);
}

mkdirSync(outputDir, { recursive: true });
if (!acquirePrepareLock()) {
  console.log(`[poracode-server] Node-ABI better-sqlite3 binding is current: ${outputFile}`);
  process.exit(0);
}

try {
  if (!bindingWorks(outputFile)) {
    rmSync(stageRoot, { recursive: true, force: true });
    mkdirSync(dirname(stageRoot), { recursive: true });
    cpSync(betterSqliteRoot, stageRoot, {
      recursive: true,
      filter: (source) => {
        const rel = relative(betterSqliteRoot, source);
        return rel === "" || !rel.split(/[\\/]/).includes("build");
      },
    });

    run(process.execPath, [nodeGypJs, "rebuild", "--release"], {
      cwd: stageRoot,
      env: {
        ...process.env,
        npm_config_runtime: "node",
        npm_config_target: process.versions.node,
        PATH: `${join(repoRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
      },
    });

    const builtBinding = join(stageRoot, "build", "Release", "better_sqlite3.node");
    if (!existsSync(builtBinding)) {
      throw new Error(`better-sqlite3 build did not produce ${builtBinding}`);
    }
    copyFileSync(builtBinding, outputFile);
  }
} finally {
  rmSync(prepareLock, { recursive: true, force: true });
}
console.log(`[poracode-server] prepared Node-ABI better-sqlite3 binding: ${outputFile}`);
console.log("[poracode-server] headless server will use it automatically from this repo.");
