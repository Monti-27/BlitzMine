import { promises as fs } from "node:fs";
import path from "node:path";

const TARGET_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "@privy-io",
  "react-auth",
  "dist",
);

const TARGET_EXTENSIONS = new Set([".mjs", ".js", ".cjs"]);

const BACKGROUND_SHORTHAND_REGEX =
  /background:\s*`url\((['"])\$\{([^}]+)\}\1\)\s*0\s*0\s*\/\s*contain`,/g;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (TARGET_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function patchContent(source) {
  return source.replace(
    BACKGROUND_SHORTHAND_REGEX,
    (_match, quote, expr) => {
      const dynamicExpr = `\${${expr}}`;
      return `backgroundImage:\`url(${quote}${dynamicExpr}${quote})\`,backgroundRepeat:"no-repeat",backgroundPosition:"0 0",`;
    },
  );
}

async function main() {
  try {
    await fs.access(TARGET_DIR);
  } catch {
    console.info("[fix-privy-background-warning] Privy dist not found, skipping.");
    return;
  }

  const files = await walk(TARGET_DIR);
  let patchedFiles = 0;

  await Promise.all(
    files.map(async (filePath) => {
      const before = await fs.readFile(filePath, "utf8");
      if (!before.includes("0 0 / contain") || !before.includes("backgroundSize")) {
        return;
      }

      const after = patchContent(before);
      if (after === before) {
        return;
      }

      await fs.writeFile(filePath, after, "utf8");
      patchedFiles += 1;
    }),
  );

  if (patchedFiles > 0) {
    console.info(
      `[fix-privy-background-warning] Patched ${patchedFiles} Privy file(s) to avoid background shorthand conflict.`,
    );
  } else {
    console.info("[fix-privy-background-warning] No patch needed.");
  }
}

void main();
