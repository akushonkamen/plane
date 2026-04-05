#!/usr/bin/env node

/**
 * Plane Development Environment Setup Script
 * One-command setup for local development environment
 *
 * Usage:
 *   node scripts/setup.js          # Frontend-only (no Docker needed)
 *   node scripts/setup.js --full   # Full stack with Docker infra
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const FULL_MODE = process.argv.includes("--full");

// ANSI colors
const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const log = (msg, color = c.reset) => console.log(`${color}${msg}${c.reset}`);
const logStep = (step, msg) => log(`\n${c.bright}${c.blue}[${step}]${c.reset} ${msg}`);
const logOk = (msg) => log(`  ${c.green}✓${c.reset} ${msg}`);
const logErr = (msg) => log(`  ${c.red}✗${c.reset} ${msg}`);
const logWarn = (msg) => log(`  ${c.yellow}⚠${c.reset} ${msg}`);

// Spinner
const spinChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinner = null;
function startSpin(msg) {
  let i = 0;
  process.stdout.write(`  ${c.cyan}${spinChars[0]}${c.reset} ${msg}`);
  spinner = setInterval(() => {
    process.stdout.write(`\r  ${c.cyan}${spinChars[++i % spinChars.length]}${c.reset} ${msg}`);
  }, 100);
}
function stopSpin(ok, msg) {
  if (spinner) {
    clearInterval(spinner);
    spinner = null;
  }
  if (msg) process.stdout.write(`\r  ${ok ? c.green + "✓" : c.red + "✗"}${c.reset} ${msg}\n`);
}

// --- Helpers ---

function hasCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasDocker() {
  // Check common Docker paths
  const paths = [
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ];
  if (hasCommand("docker")) return true;
  for (const p of paths) {
    if (fs.existsSync(p)) return true;
  }
  return false;
}

function isDockerRunning() {
  try {
    const dockerPath = findDockerBin();
    execSync(`${dockerPath} info`, { stdio: "ignore", env: dockerEnv() });
    return true;
  } catch {
    return false;
  }
}

function findDockerBin() {
  try {
    return execSync("which docker", { encoding: "utf8" }).trim();
  } catch {}
  const paths = [
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return "docker";
}

function dockerEnv() {
  const bin = findDockerBin();
  const dir = path.dirname(bin);
  if (process.env.PATH.includes(dir)) return process.env;
  return { ...process.env, PATH: `${dir}:${process.env.PATH}` };
}

function execDocker(cmd, opts = {}) {
  return execSync(cmd, { ...opts, env: dockerEnv() });
}

// --- Steps ---

function checkPrerequisites() {
  logStep("1/4", "Checking prerequisites...");
  let ok = true;

  // Node.js (required)
  try {
    const v = execSync("node --version", { encoding: "utf8" }).trim();
    const major = parseInt(v.slice(1));
    if (major >= 22) logOk(`Node.js ${v}`);
    else {
      logErr(`Node.js ${v} — need >=22`);
      ok = false;
    }
  } catch {
    logErr("Node.js not found");
    ok = false;
  }

  // pnpm (required)
  try {
    const v = execSync("pnpm --version", { encoding: "utf8" }).trim();
    logOk(`pnpm ${v}`);
  } catch {
    logErr("pnpm not found. Run: corepack enable && corepack prepare pnpm@latest --activate");
    ok = false;
  }

  // Docker (optional, only warn in --full mode)
  const dockerAvail = hasDocker();
  const dockerRunning = dockerAvail && isDockerRunning();
  if (dockerRunning) logOk("Docker (running)");
  else if (dockerAvail) logWarn("Docker installed but not running");
  else logWarn("Docker not found (frontend-only mode)");

  if (FULL_MODE && !dockerRunning) {
    logErr("Docker is required for --full mode. Start Docker Desktop first.");
    ok = false;
  }

  // Python (optional, only needed for API)
  try {
    const v = execSync("python3 --version", { encoding: "utf8" }).trim();
    logOk(`${v} (for Django API)`);
  } catch {
    logWarn("Python not found (frontend-only mode)");
  }

  if (!ok) process.exit(1);

  if (!FULL_MODE) {
    log(`\n  ${c.cyan}Mode: frontend-only${c.reset} (use ${c.bright}--full${c.reset} for full-stack with Docker)`);
  } else {
    log(`\n  ${c.cyan}Mode: full-stack (Docker infra + API + frontend)${c.reset}`);
  }
}

function setupEnvironment() {
  logStep("2/4", "Setting up environment files...");
  const root = path.resolve(__dirname, "..");
  const services = ["", "web", "api", "space", "admin", "live"];

  for (const svc of services) {
    const prefix = svc ? path.join(root, "apps", svc) : root;
    const example = path.join(prefix, ".env.example");
    const env = path.join(prefix, ".env");
    if (fs.existsSync(example) && !fs.existsSync(env)) {
      fs.copyFileSync(example, env);
      logOk(`Created ${svc ? `apps/${svc}/` : ""}.env`);
    } else if (fs.existsSync(env)) {
      logOk(`${svc ? `apps/${svc}/` : ""}.env already exists`);
    }
  }

  // Generate Django SECRET_KEY
  const apiEnv = path.join(root, "apps", "api", ".env");
  if (fs.existsSync(apiEnv)) {
    const content = fs.readFileSync(apiEnv, "utf8");
    if (!content.includes("SECRET_KEY")) {
      const chars = "abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
      let key = "";
      for (let i = 0; i < 50; i++) key += chars[Math.floor(Math.random() * chars.length)];
      fs.appendFileSync(apiEnv, `\nSECRET_KEY="${key}"\n`);
      logOk("Generated Django SECRET_KEY");
    }
  }
}

function installDependencies() {
  logStep("3/4", "Installing dependencies...");
  try {
    startSpin("pnpm install...");
    execSync("pnpm install", { stdio: "pipe" });
    stopSpin(true, "Dependencies installed");
  } catch (_e) {
    stopSpin(false, "Install failed");
    logErr(e.message);
    process.exit(1);
  }
}

async function startDockerInfra() {
  if (!FULL_MODE) return;
  const { waitForServices } = require("./lib/health-check");

  logStep("4/4", "Starting Docker infrastructure...");
  const composeFile = path.resolve(__dirname, "..", "docker-compose-local.yml");
  if (!fs.existsSync(composeFile)) {
    logErr("docker-compose-local.yml not found");
    process.exit(1);
  }

  try {
    const dockerCompose = findDockerCompose();
    execDocker(`${dockerCompose} -f ${composeFile} up -d`, { stdio: "pipe" });
    logOk("Docker services started");
  } catch (_e) {
    logErr(`Docker start failed: ${e.message}`);
    process.exit(1);
  }

  // Wait for services
  log("  Waiting for services...");
  const services = [
    { name: "PostgreSQL", type: "tcp", host: "localhost", port: 5432 },
    { name: "Redis", type: "tcp", host: "localhost", port: 6379 },
    { name: "RabbitMQ", type: "tcp", host: "localhost", port: 5672 },
    { name: "MinIO", type: "tcp", host: "localhost", port: 9000 },
  ];
  const result = await waitForServices(services, { timeout: 60000, interval: 2000 });
  if (result.allReady) {
    logOk(`All services ready in ${(result.totalDuration / 1000).toFixed(1)}s`);
  } else {
    logWarn("Some services not ready — continuing anyway");
  }

  // Run migrations
  try {
    const apiDir = path.resolve(__dirname, "..", "apps", "api");
    startSpin("Running migrations...");
    execSync("python3 manage.py migrate --settings=plane.settings.local", {
      cwd: apiDir,
      stdio: "pipe",
    });
    stopSpin(true, "Migrations completed");
  } catch (_e) {
    stopSpin(false, "Migrations failed");
    logWarn("You can run migrations manually later");
  }
}

function findDockerCompose() {
  try {
    execDocker("docker compose version", { stdio: "ignore" });
    return "docker compose";
  } catch {}
  try {
    execDocker("docker-compose --version", { stdio: "ignore" });
    return "docker-compose";
  } catch {
    return "docker compose";
  }
}

function printSuccess() {
  log("\n" + "═".repeat(60));
  log(c.bright + c.green + "  Setup complete!" + c.reset);
  log("═".repeat(60));

  if (FULL_MODE) {
    log(`\n  ${c.bright}All services:${c.reset}`);
    log(`    Web:       ${c.cyan}http://localhost:3000${c.reset}`);
    log(`    Admin:     ${c.cyan}http://localhost:3001${c.reset}`);
    log(`    API:       ${c.cyan}http://localhost:8000${c.reset}`);
    log(`    MinIO:     ${c.cyan}http://localhost:9000${c.reset}`);
    log(`\n  ${c.bright}Commands:${c.reset}`);
    log(`    ${c.green}npm run dev:full${c.reset}  Start all services`);
    log(`    ${c.green}npm stop${c.reset}          Stop everything`);
  } else {
    log(`\n  ${c.bright}Frontend mode:${c.reset}`);
    log(`    Web:       ${c.cyan}http://localhost:3000${c.reset}`);
    log(`    Admin:     ${c.cyan}http://localhost:3001${c.reset}`);
    log(`\n  ${c.bright}Commands:${c.reset}`);
    log(`    ${c.green}pnpm dev${c.reset}            Start frontend dev servers`);
    log(`    ${c.green}npm run setup -- --full${c.reset}  Full stack with Docker`);
  }
  log("");
}

// --- Main ---

async function main() {
  log(c.bright + c.cyan);
  log("  ╔═══════════════════════════════════════════════╗");
  log("  ║         Plane - Project Management            ║");
  log("  ╚═══════════════════════════════════════════════╝");
  log(c.reset);

  try {
    checkPrerequisites();
    setupEnvironment();
    installDependencies();
    await startDockerInfra();
    printSuccess();
  } catch (_e) {
    logErr(`Setup failed: ${e.message}`);
    process.exit(1);
  }
}

main();
