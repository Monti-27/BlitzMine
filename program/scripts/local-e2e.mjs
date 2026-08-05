import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const programDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryDirectory = path.resolve(programDirectory, "..");
const runtimeDirectory = path.join(programDirectory, ".local-e2e");
const logDirectory = path.join(runtimeDirectory, "logs");
const packageVersion = "0.13.19";
const programId = "CVud2PiM4hYk2YkDa2DZ2dnJwd9gVCXZFJP18DzE1r4F";
const validatorIdentity = "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev";
const localVrfQueue = "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT";
const committorProgram = "ComtrB2KEaWgXsW1dhr1xYL4Ht4Bjj3gXnnL6KMdABq";
const committorArtifact = path.join(
  programDirectory,
  "fixtures",
  "magicblock_committor_program.so",
);
const committorHash =
  "c739cba85ee1863bf28bb382de1ed81aab5af527a1630d2dacd02683140121a9";
const localAdminAddress = "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj";
const browserMode = process.argv.includes("--browser");
const programFeature = browserMode ? "local-ui" : "local-e2e";
const composeFile = path.join(
  repositoryDirectory,
  "infrastructure",
  "docker",
  "docker-compose.yml",
);
const children = [];
const streams = [];
let composeStarted = false;
let cleanupStarted = false;

fs.rmSync(runtimeDirectory, { recursive: true, force: true });
fs.mkdirSync(logDirectory, { recursive: true });

function verifyCommittorArtifact() {
  const artifact = fs.readFileSync(committorArtifact);
  const actualHash = createHash("sha256").update(artifact).digest("hex");
  if (actualHash !== committorHash) {
    throw new Error(`MagicBlock committor artifact hash mismatch: ${actualHash}`);
  }
}

function prepareLocalAdminKeypair() {
  const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const keypair = Keypair.fromSeed(seed);
  if (keypair.publicKey.toBase58() !== localAdminAddress) {
    throw new Error("Local admin keypair is invalid");
  }
  const outputPath = path.join(runtimeDirectory, "admin-keypair.json");
  fs.writeFileSync(outputPath, JSON.stringify(Array.from(keypair.secretKey)));
  return outputPath;
}

function prepareLocalVrfQueue() {
  const cacheDirectory = path.join(
    os.homedir(),
    ".bun",
    "install",
    "cache",
    "@magicblock-labs",
  );
  const packageDirectory = fs
    .readdirSync(cacheDirectory)
    .filter((entry) => entry.startsWith(`ephemeral-validator@${packageVersion}`))
    .sort()
    .at(-1);
  if (!packageDirectory) {
    throw new Error(`MagicBlock local package ${packageVersion} is not cached`);
  }
  const sourcePath = path.join(
    cacheDirectory,
    packageDirectory,
    "bin",
    "local-dumps",
    `${localVrfQueue}.json`,
  );
  const queue = fs.readFileSync(sourcePath, "utf8");
  const encodedData = queue.match(/"data"\s*:\s*\[\s*"([^"]+)"/)?.[1];
  if (!encodedData) {
    throw new Error("Local VRF queue data is invalid");
  }
  const data = Buffer.from(encodedData, "base64");
  data.writeUInt32LE(0, 8);
  data.writeUInt32LE(16, 12);
  data.fill(0, 20);
  const outputPath = path.join(runtimeDirectory, `${localVrfQueue}.json`);
  fs.writeFileSync(outputPath, queue.replace(encodedData, data.toString("base64")));
  return outputPath;
}

function service(
  name,
  command,
  args,
  environment = {},
  workingDirectory = programDirectory,
) {
  const stream = fs.createWriteStream(path.join(logDirectory, `${name}.log`));
  const child = spawn(command, args, {
    cwd: workingDirectory,
    detached: true,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  children.push(child);
  streams.push(stream);
  return child;
}

async function command(
  name,
  executable,
  args,
  environment = {},
  workingDirectory = programDirectory,
) {
  process.stdout.write(`\n${name}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workingDirectory,
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${executable} failed with ${signal ? `signal ${signal}` : `code ${code}`}`,
        ),
      );
    });
  });
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message);
  }
  return payload.result;
}

async function waitForService(name, child, url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${name} exited with code ${child.exitCode}`);
    }
    try {
      const health = await rpc(url, "getHealth");
      if (health === "ok") {
        process.stdout.write(`${name} is ready\n`);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} did not become ready`);
}

async function waitForHttp(name, child, url, ready, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${name} exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      const payload = await response.json().catch(() => null);
      if (ready(response, payload)) {
        process.stdout.write(`${name} is ready\n`);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not become ready`);
}

function parseEnvironmentFile(filePath) {
  const entries = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    entries[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
  return entries;
}

function verifyBrowserConfiguration() {
  const backendPath = path.join(repositoryDirectory, "backend", ".env");
  const frontendPath = path.join(repositoryDirectory, "frontend", ".env.local");
  if (!fs.existsSync(backendPath) || !fs.existsSync(frontendPath)) {
    throw new Error("Local backend and frontend environment files are required");
  }
  const backend = parseEnvironmentFile(backendPath);
  const frontend = parseEnvironmentFile(frontendPath);
  if (!backend.PRIVY_APP_ID || !backend.PRIVY_APP_SECRET) {
    throw new Error("Backend Privy configuration is incomplete");
  }
  if (!frontend.NEXT_PUBLIC_PRIVY_APP_ID) {
    throw new Error("Frontend Privy configuration is incomplete");
  }
  if (backend.PRIVY_APP_ID !== frontend.NEXT_PUBLIC_PRIVY_APP_ID) {
    throw new Error("Frontend and backend Privy app IDs do not match");
  }
}

async function stopServices() {
  for (const child of [...children].reverse()) {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of [...children].reverse()) {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  }
  for (const stream of streams) {
    stream.destroy();
  }
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await stopServices();
  if (composeStarted) {
    await command(
      "Stopping local data services",
      "docker",
      ["compose", "-p", "blitzmine-local", "-f", composeFile, "down"],
      {},
      repositoryDirectory,
    ).catch(() => undefined);
  }
}

process.once("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void cleanup().finally(() => process.exit(143));
});

try {
  process.stdout.write("Starting a clean MagicBlock local network\n");
  verifyCommittorArtifact();
  const localAdminKeypairPath = prepareLocalAdminKeypair();
  const localVrfQueuePath = prepareLocalVrfQueue();

  await command("Generating the current client interface", "anchor", [
    "idl",
    "build",
    "--skip-lint",
    "-o",
    "target/idl/blitzmine.json",
    "-t",
    "target/types/blitzmine.ts",
  ]);
  fs.copyFileSync(
    path.join(programDirectory, "target", "idl", "blitzmine.json"),
    path.join(repositoryDirectory, "backend", "src", "idl", "blitzmine.json"),
  );

  await command("Building the Solana program", "cargo", [
    "build-sbf",
    "--tools-version",
    "v1.53",
    "--features",
    programFeature,
  ]);

  const baseValidator = service(
    "base-validator",
    "bunx",
    [
      "--package",
      `@magicblock-labs/ephemeral-validator@${packageVersion}`,
      "mb-test-validator",
      "--reset",
      "--account",
      localVrfQueue,
      localVrfQueuePath,
      "--bpf-program",
      committorProgram,
      committorArtifact,
      "--bpf-program",
      programId,
      path.join(programDirectory, "target", "deploy", "blitzmine.so"),
    ],
    {
      RUST_LOG:
        "solana_runtime::message_processor=debug,solana_rbpf=debug,solana_bpf_loader_program=debug",
    },
  );
  await waitForService(
    "Base validator",
    baseValidator,
    "http://127.0.0.1:8899",
  );

  await command("Funding the local ephemeral validator", "solana", [
    "airdrop",
    "10",
    validatorIdentity,
    "--url",
    "http://127.0.0.1:8899",
  ]);
  await command("Funding the local game administrator", "solana", [
    "airdrop",
    "10",
    localAdminAddress,
    "--url",
    "http://127.0.0.1:8899",
  ]);

  const ephemeralValidator = service("ephemeral-validator", "bunx", [
    "--package",
    `@magicblock-labs/ephemeral-validator@${packageVersion}`,
    "ephemeral-validator",
    "--no-tui",
    "--reset",
    "--storage",
    path.join(runtimeDirectory, "er-storage"),
    "--listen",
    "127.0.0.1:7799",
    "--remotes",
    "http://127.0.0.1:8899",
    "--remotes",
    "ws://127.0.0.1:8900",
  ]);
  await waitForService(
    "Ephemeral validator",
    ephemeralValidator,
    "http://127.0.0.1:7799",
  );

  const router = service("router", "bunx", [
    "--package",
    `@magicblock-labs/ephemeral-validator@${packageVersion}`,
    "query-filtering-service",
    "--listen-addr",
    "127.0.0.1:6699",
    "--listen-addr-ws",
    "127.0.0.1:6700",
    "--ephemeral-url",
    "http://127.0.0.1:7799",
    "--ephemeral-url-ws",
    "ws://127.0.0.1:7800",
  ]);
  await waitForService("Router", router, "http://127.0.0.1:6699");

  const oracle = service(
    "vrf-oracle",
    "bunx",
    [
      "--package",
      `@magicblock-labs/ephemeral-validator@${packageVersion}`,
      "vrf-oracle",
    ],
    {
      RPC_URL: "http://127.0.0.1:7799",
      WEBSOCKET_URL: "ws://127.0.0.1:7800",
      VRF_ORACLE_SKIP_PREFLIGHT: "true",
      RUST_LOG: "info",
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (oracle.exitCode !== null) {
    throw new Error(`VRF oracle exited with code ${oracle.exitCode}`);
  }
  process.stdout.write("VRF oracle is ready\n");

  if (browserMode) {
    verifyBrowserConfiguration();
    await command(
      "Starting PostgreSQL and Redis",
      "docker",
      [
        "compose",
        "-p",
        "blitzmine-local",
        "-f",
        composeFile,
        "up",
        "-d",
        "postgres",
        "redis",
      ],
      {},
      repositoryDirectory,
    );
    composeStarted = true;
    await command(
      "Applying database migrations",
      "bunx",
      ["prisma", "migrate", "deploy"],
      {},
      path.join(repositoryDirectory, "backend"),
    );
    const localRuntime = {
      SOLANA_CLUSTER: "devnet",
      SOLANA_RPC_URL: "http://127.0.0.1:8899",
      SOLANA_WS_URL: "ws://127.0.0.1:8900",
      MAGIC_ROUTER_URL: "http://127.0.0.1:6699",
      EPHEMERAL_RPC_URL: "http://127.0.0.1:7799",
      EPHEMERAL_WS_URL: "ws://127.0.0.1:7800",
      EPHEMERAL_VALIDATOR: validatorIdentity,
      PROGRAM_ID: programId,
    };
    const backend = service(
      "backend",
      "bun",
      ["run", "start:dev"],
      {
        ...localRuntime,
        ADMIN_KEYPAIR: fs.readFileSync(localAdminKeypairPath, "utf8"),
        LOCAL_DEV_FAUCET_ENABLED: "true",
        PORT: "3001",
        FRONTEND_URL: "http://localhost:3000",
        FRONTEND_URLS: "http://localhost:3000,http://127.0.0.1:3000",
      },
      path.join(repositoryDirectory, "backend"),
    );
    await waitForHttp(
      "Backend",
      backend,
      "http://127.0.0.1:3001/health",
      (response, payload) => response.ok && payload?.database === "ok",
      90_000,
    );
    await waitForHttp(
      "Game lifecycle",
      backend,
      "http://127.0.0.1:3001/rounds/current",
      (response, payload) => response.ok && Number.isInteger(payload?.id),
      90_000,
    );
    const frontend = service(
      "frontend",
      "bunx",
      ["next", "dev", "--hostname", "127.0.0.1", "--port", "3000"],
      {
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001",
        NEXT_PUBLIC_WS_URL: "ws://127.0.0.1:3001",
        NEXT_PUBLIC_SOLANA_CLUSTER: "devnet",
        NEXT_PUBLIC_SOLANA_RPC_URL: "http://127.0.0.1:8899",
        NEXT_PUBLIC_PROGRAM_ID: programId,
        NEXT_PUBLIC_ALLOW_NON_MAINNET_IN_PRODUCTION: "true",
      },
      path.join(repositoryDirectory, "frontend"),
    );
    await waitForHttp(
      "Frontend",
      frontend,
      "http://127.0.0.1:3000",
      (response) => response.ok,
      90_000,
    );
    process.stdout.write(
      `\nBlitzMine local browser stack is ready\nFrontend: http://127.0.0.1:3000\nBackend: http://127.0.0.1:3001/health\nLogs: ${logDirectory}\nPress Ctrl+C to stop the stack\n`,
    );
    await new Promise(() => undefined);
  } else {
    await command(
      "Running one complete BlitzMine round",
      "bun",
      ["run", "test:e2e:local"],
      { ADMIN_KEYPAIR_PATH: localAdminKeypairPath },
    );

    process.stdout.write(
      `\nFull cycle passed\nEvidence: ${path.join(runtimeDirectory, "result.json")}\nLogs: ${logDirectory}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `\nFull cycle failed: ${error instanceof Error ? error.message : String(error)}\nLogs: ${logDirectory}\n`,
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}
