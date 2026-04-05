#!/usr/bin/env node

/**
 * Plane Development Environment Setup Script
 * One-command setup for local development environment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { waitForServices } = require('./lib/health-check');
const { isDockerRunning, startServices } = require('./lib/docker');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Logger with colors
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n${colors.bright}${colors.blue}[${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  log(`  ${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
  log(`  ${colors.red}✗${colors.reset} ${message}`);
}

function logWarning(message) {
  log(`  ${colors.yellow}⚠${colors.reset} ${message}`);
}

// Spinner for progress indication
let spinnerInterval = null;
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(message) {
  process.stdout.write(`  ${colors.cyan}${spinnerChars[0]}${colors.reset} ${message}`);
  let i = 0;
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r  ${colors.cyan}${spinnerChars[i % spinnerChars.length]}${colors.reset} ${message}`);
    i++;
  }, 100);
}

function stopSpinner(success = true, message = '') {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
  if (message) {
    process.stdout.write(`\r  ${success ? colors.green + '✓' : colors.red + '✗'}${colors.reset} ${message}\n`);
  } else {
    process.stdout.write('\r');
  }
}

// Check prerequisites
function checkPrerequisites() {
  logStep('1/7', 'Checking prerequisites...');

  const checks = [];

  // Check Node.js version
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion >= 22) {
      checks.push({ name: 'Node.js', version: nodeVersion, ok: true });
    } else {
      checks.push({ name: 'Node.js', version: nodeVersion, ok: false, error: 'Version 22 or higher required' });
    }
  } catch (error) {
    checks.push({ name: 'Node.js', ok: false, error: 'Not found' });
  }

  // Check pnpm
  try {
    const pnpmVersion = execSync('pnpm --version', { encoding: 'utf8' }).trim();
    checks.push({ name: 'pnpm', version: pnpmVersion, ok: true });
  } catch (error) {
    checks.push({ name: 'pnpm', ok: false, error: 'Not found. Run: corepack enable && corepack prepare pnpm@latest --activate' });
  }

  // Check Docker
  const dockerOk = isDockerRunning();
  checks.push({ name: 'Docker', ok: dockerOk, error: dockerOk ? null : 'Docker daemon not running' });

  // Check Python
  try {
    const pythonVersion = execSync('python3 --version', { encoding: 'utf8' }).trim();
    checks.push({ name: 'Python', version: pythonVersion, ok: true });
  } catch (error) {
    checks.push({ name: 'Python', ok: false, error: 'Not found' });
  }

  // Display results
  let allOk = true;
  for (const check of checks) {
    if (check.ok) {
      const versionStr = check.version ? ` (${check.version})` : '';
      logSuccess(`${check.name}${versionStr}`);
    } else {
      logError(`${check.name}: ${check.error}`);
      allOk = false;
    }
  }

  if (!allOk) {
    log('\nPlease fix the above issues before continuing.');
    process.exit(1);
  }
}

// Setup environment files
function setupEnvironment() {
  logStep('2/7', 'Setting up environment files...');

  const projectRoot = path.resolve(__dirname, '..');
  const services = ['', 'web', 'api', 'space', 'admin', 'live'];

  for (const service of services) {
    const prefix = service ? path.join(projectRoot, 'apps', service) : projectRoot;
    const envExample = path.join(prefix, '.env.example');
    const envFile = path.join(prefix, '.env');

    if (fs.existsSync(envExample)) {
      if (!fs.existsSync(envFile)) {
        fs.copyFileSync(envExample, envFile);
        logSuccess(`Created ${service ? `apps/${service}/` : ''}.env`);
      } else {
        logSuccess(`${service ? `apps/${service}/` : ''}.env already exists`);
      }
    }
  }

  // Generate SECRET_KEY for Django
  const apiEnvFile = path.join(projectRoot, 'apps', 'api', '.env');
  if (fs.existsSync(apiEnvFile)) {
    const envContent = fs.readFileSync(apiEnvFile, 'utf8');
    if (!envContent.includes('SECRET_KEY')) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let secretKey = '';
      for (let i = 0; i < 50; i++) {
        secretKey += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      fs.appendFileSync(apiEnvFile, `\nSECRET_KEY="${secretKey}"\n`);
      logSuccess('Generated SECRET_KEY for Django');
    } else {
      logSuccess('SECRET_KEY already exists in apps/api/.env');
    }
  }
}

// Install dependencies
function installDependencies() {
  logStep('3/7', 'Installing Node.js dependencies...');

  try {
    startSpinner('Running pnpm install...');
    execSync('pnpm install', { stdio: 'pipe' });
    stopSpinner(true, 'Dependencies installed');
  } catch (error) {
    stopSpinner(false, 'Failed to install dependencies');
    logError(error.message);
    process.exit(1);
  }
}

// Start Docker infrastructure
function startInfrastructure() {
  logStep('4/7', 'Starting Docker infrastructure...');

  const composeFile = path.resolve(__dirname, '..', 'docker-compose-local.yml');

  if (!fs.existsSync(composeFile)) {
    logError('docker-compose-local.yml not found');
    process.exit(1);
  }

  const result = startServices(composeFile, true);

  if (result.success) {
    logSuccess('Docker services started');
  } else {
    logError(`Failed to start Docker services: ${result.error}`);
    process.exit(1);
  }
}

// Wait for services to be ready
async function waitForInfrastructure() {
  logStep('5/7', 'Waiting for services to be ready...');

  const services = [
    { name: 'PostgreSQL', type: 'tcp', host: 'localhost', port: 5432 },
    { name: 'Redis', type: 'tcp', host: 'localhost', port: 6379 },
    { name: 'RabbitMQ', type: 'tcp', host: 'localhost', port: 5672 },
    { name: 'MinIO', type: 'tcp', host: 'localhost', port: 9000 }
  ];

  const result = await waitForServices(services, {
    timeout: 60000,
    interval: 2000,
    showProgress: true
  });

  if (result.allReady) {
    logSuccess(`All services ready in ${(result.totalDuration / 1000).toFixed(1)}s`);
  } else {
    logError('Some services failed to start:');
    for (const [name, status] of Object.entries(result.services)) {
      if (!status.ready) {
        logError(`  ${name}: ${status.error || 'Not ready'}`);
      }
    }
    process.exit(1);
  }
}

// Run Django migrations
function runMigrations() {
  logStep('6/7', 'Running Django migrations...');

  const apiDir = path.resolve(__dirname, '..', 'apps', 'api');

  if (!fs.existsSync(apiDir)) {
    logError('apps/api directory not found');
    process.exit(1);
  }

  try {
    startSpinner('Running migrations...');
    execSync('python manage.py migrate --settings=plane.settings.local', {
      cwd: apiDir,
      stdio: 'pipe'
    });
    stopSpinner(true, 'Migrations completed');
  } catch (error) {
    stopSpinner(false, 'Migration failed');
    logError(error.message);
    process.exit(1);
  }
}

// Optional: Create superuser
function promptSuperuser() {
  logStep('7/7', 'Optional: Create Django superuser');

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  question('Create a superuser now? (y/N): ').then((answer) => {
    if (answer.toLowerCase() === 'y') {
      rl.close();
      const apiDir = path.resolve(__dirname, '..', 'apps', 'api');
      log('Opening superuser creation prompt...\n');
      execSync('python manage.py createsuperuser --settings=plane.settings.local', {
        cwd: apiDir,
        stdio: 'inherit'
      });
    } else {
      rl.close();
    }
  });
}

// Print success message
function printSuccess() {
  log('\n' + '='.repeat(70));
  log(colors.bright + colors.green + 'Setup completed successfully!' + colors.reset);
  log('='.repeat(70) + '\n');

  log(colors.bright + 'Services are running:' + colors.reset);
  log('  • Web UI:       http://localhost:3000');
  log('  • Admin Panel:  http://localhost:3001');
  log('  • API Server:   http://localhost:8000');
  log('  • MinIO Console: http://localhost:9090\n');

  log(colors.bright + 'Next steps:' + colors.reset);
  log('  1. Start development servers: npm run dev:full');
  log('  2. Or start individual components:');
  log('     - API only:   npm run dev:api');
  log('     - Frontend:   npm run dev');
  log('  3. Stop all services: npm run stop\n');

  log(colors.bright + 'Happy coding! 🚀' + colors.reset + '\n');
}

// Main execution
async function main() {
  log(colors.bright + colors.cyan);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('                   Plane - Project Management Tool');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(colors.reset);
  log(colors.bright + 'Setting up your development environment...\n' + colors.reset);

  try {
    checkPrerequisites();
    setupEnvironment();
    installDependencies();
    startInfrastructure();
    await waitForInfrastructure();
    runMigrations();
    printSuccess();

    // Prompt for superuser creation (non-blocking)
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt) => {
      return new Promise((resolve) => {
        rl.question(prompt, resolve);
      });
    };

    const createSuperuser = await question('Create a superuser now? (y/N): ');
    rl.close();

    if (createSuperuser.toLowerCase() === 'y') {
      const apiDir = path.resolve(__dirname, '..', 'apps', 'api');
      log('\nOpening superuser creation prompt...\n');
      execSync('python manage.py createsuperuser --settings=plane.settings.local', {
        cwd: apiDir,
        stdio: 'inherit'
      });
    }
  } catch (error) {
    logError(`Setup failed: ${error.message}`);
    process.exit(1);
  }
}

// Run main function
main();
