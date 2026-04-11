#!/usr/bin/env node

/**
 * Plane Development Server Orchestrator
 * Starts all development servers with proper process management
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { isDockerRunning, startServices, getRunningServices } = require('./lib/docker');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

// Process tracking
const processes = {};
const pidDir = path.join(__dirname, '.pids');

// Ensure PID directory exists
if (!fs.existsSync(pidDir)) {
  fs.mkdirSync(pidDir, { recursive: true });
}

// Logger with service prefixes
function log(message, service = 'DEV') {
  const timestamp = new Date().toLocaleTimeString();
  const color = getServiceColor(service);
  console.log(`${colors.dim}${timestamp}${colors.reset} ${color}[${service}]${colors.reset} ${message}`);
}

function logError(message, service = 'DEV') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}${timestamp}${colors.reset} ${colors.red}[${service}]${colors.reset} ${colors.red}${message}${colors.reset}`);
}

function logSuccess(message, service = 'DEV') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}${timestamp}${colors.reset} ${colors.green}[${service}]${colors.reset} ${colors.green}${message}${colors.reset}`);
}

function getServiceColor(service) {
  const colorMap = {
    'API': colors.cyan,
    'WEB': colors.blue,
    'ADMIN': colors.magenta,
    'SPACE': colors.yellow,
    'LIVE': colors.green,
    'INFRA': colors.magenta,
    'DEV': colors.bright
  };
  return colorMap[service] || colors.reset;
}

// Save PID to file
function savePid(service, pid) {
  const pidFile = path.join(pidDir, `${service.toLowerCase()}.pid`);
  fs.writeFileSync(pidFile, pid.toString());
}

// Load PIDs from files
function loadPids() {
  const pids = {};
  if (fs.existsSync(pidDir)) {
    const files = fs.readdirSync(pidDir);
    for (const file of files) {
      if (file.endsWith('.pid')) {
        const service = file.replace('.pid', '').toUpperCase();
        const pidFile = path.join(pidDir, file);
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        if (!isNaN(pid)) {
          pids[service] = pid;
        }
      }
    }
  }
  return pids;
}

// Clean up PID files
function cleanupPidFiles() {
  if (fs.existsSync(pidDir)) {
    const files = fs.readdirSync(pidDir);
    for (const file of files) {
      const pidFile = path.join(pidDir, file);
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        if (!isNaN(pid)) {
          // Check if process is still running
          try {
            process.kill(pid, 0); // Signal 0 checks if process exists
            process.kill(pid, 'SIGTERM');
          } catch (e) {
            // Process doesn't exist, just remove the file
          }
        }
        fs.unlinkSync(pidFile);
      } catch (error) {
        // File might be locked or process doesn't exist
      }
    }
  }
}

// Kill a process gracefully
function killProcess(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    return false;
  }
}

// Start Django API server
function startApiServer() {
  return new Promise((resolve, reject) => {
    const apiDir = path.resolve(__dirname, '..', 'apps', 'api');

    if (!fs.existsSync(apiDir)) {
      reject(new Error('apps/api directory not found'));
      return;
    }

    log('Starting Django API server...', 'API');

    const apiProcess = spawn('python', ['manage.py', 'runserver', '0.0.0.0:8000', '--settings=plane.settings.local'], {
      cwd: apiDir,
      stdio: 'pipe',
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    apiProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        log(line, 'API');
      }
    });

    apiProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        logError(line, 'API');
      }
    });

    apiProcess.on('error', (error) => {
      logError(`Failed to start API server: ${error.message}`, 'API');
      reject(error);
    });

    apiProcess.on('exit', (code, signal) => {
      if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
        logError(`API server exited with code ${code}`, 'API');
      }
    });

    // Wait a moment to see if it starts successfully
    setTimeout(() => {
      if (apiProcess.exitCode === null) {
        processes['API'] = apiProcess;
        savePid('API', apiProcess.pid);
        logSuccess('API server running on http://localhost:8000', 'API');
        resolve(apiProcess);
      } else {
        reject(new Error('API server failed to start'));
      }
    }, 2000);
  });
}

// Start frontend dev servers
function startFrontendServers() {
  return new Promise((resolve, reject) => {
    log('Starting frontend dev servers...', 'WEB');

    const frontendProcess = spawn('pnpm', ['dev'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
      env: { ...process.env }
    });

    frontendProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        // Try to identify which service the line belongs to
        let service = 'WEB';
        if (line.includes('admin')) service = 'ADMIN';
        else if (line.includes('space')) service = 'SPACE';
        else if (line.includes('live')) service = 'LIVE';
        else if (line.includes('web')) service = 'WEB';

        log(line, service);
      }
    });

    frontendProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        let service = 'WEB';
        if (line.includes('admin')) service = 'ADMIN';
        else if (line.includes('space')) service = 'SPACE';
        else if (line.includes('live')) service = 'LIVE';

        logError(line, service);
      }
    });

    frontendProcess.on('error', (error) => {
      logError(`Failed to start frontend servers: ${error.message}`, 'WEB');
      reject(error);
    });

    frontendProcess.on('exit', (code, signal) => {
      if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
        logError(`Frontend servers exited with code ${code}`, 'WEB');
      }
    });

    // Wait a moment to see if it starts successfully
    setTimeout(() => {
      if (frontendProcess.exitCode === null) {
        processes['WEB'] = frontendProcess;
        savePid('WEB', frontendProcess.pid);
        logSuccess('Frontend servers starting...', 'WEB');
        resolve(frontendProcess);
      } else {
        reject(new Error('Frontend servers failed to start'));
      }
    }, 3000);
  });
}

// Ensure Docker infrastructure is running
async function ensureInfrastructure() {
  log('Checking Docker infrastructure...', 'INFRA');

  if (!isDockerRunning()) {
    logError('Docker is not running. Please start Docker and try again.', 'INFRA');
    process.exit(1);
  }

  const composeFile = path.resolve(__dirname, '..', 'docker-compose-local.yml');
  const runningServices = getRunningServices(composeFile);

  const requiredServices = ['plane-db', 'plane-redis', 'plane-mq', 'plane-minio'];
  const missingServices = requiredServices.filter(svc => !runningServices.includes(svc));

  if (missingServices.length > 0) {
    log(`Starting missing services: ${missingServices.join(', ')}`, 'INFRA');
    const result = startServices(composeFile, true);
    if (result.success) {
      logSuccess('Docker services started', 'INFRA');
    } else {
      logError(`Failed to start Docker services: ${result.error}`, 'INFRA');
      process.exit(1);
    }
  } else {
    logSuccess('Docker infrastructure already running', 'INFRA');
  }
}

// Setup signal handlers for graceful shutdown
function setupSignalHandlers() {
  const shutdown = async (signal) => {
    log(`\nReceived ${signal}, shutting down gracefully...`, 'DEV');

    // Kill all tracked processes
    for (const [service, proc] of Object.entries(processes)) {
      log(`Stopping ${service}...`, 'DEV');
      killProcess(proc.pid, 'SIGTERM');
    }

    // Give processes time to cleanup
    setTimeout(() => {
      // Force kill if still running
      for (const [service, proc] of Object.entries(processes)) {
        if (proc.exitCode === null) {
          log(`Force killing ${service}...`, 'DEV');
          killProcess(proc.pid, 'SIGKILL');
        }
      }

      // Clean up PID files
      cleanupPidFiles();

      log('Shutdown complete', 'DEV');
      process.exit(0);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logError(`Uncaught exception: ${error.message}`, 'DEV');
    shutdown('uncaughtException');
  });
}

// Print startup banner
function printBanner() {
  console.log('');
  console.log(colors.bright + colors.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('                   Plane Development Servers');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
  console.log('');
}

// Print service URLs
function printServiceUrls() {
  console.log('');
  console.log(colors.bright + '🚀 Development servers are running!' + colors.reset);
  console.log('');
  console.log('  ' + colors.cyan + 'API Server:' + colors.reset + '     http://localhost:8000');
  console.log('  ' + colors.blue + 'Web UI:' + colors.reset + '        http://localhost:3000');
  console.log('  ' + colors.magenta + 'Admin Panel:' + colors.reset + '  http://localhost:3001');
  console.log('  ' + colors.yellow + 'MinIO Console:' + colors.reset + ' http://localhost:9090');
  console.log('');
  console.log(colors.dim + '  Press Ctrl+C to stop all servers' + colors.reset);
  console.log('');
}

// Main execution
async function main() {
  printBanner();

  try {
    // Check and start Docker infrastructure
    await ensureInfrastructure();

    // Start API server
    try {
      await startApiServer();
    } catch (error) {
      logError(`Failed to start API server: ${error.message}`, 'DEV');
      process.exit(1);
    }

    // Start frontend servers
    try {
      await startFrontendServers();
    } catch (error) {
      logError(`Failed to start frontend servers: ${error.message}`, 'DEV');
      // Kill API server before exiting
      if (processes['API']) {
        killProcess(processes['API'].pid);
      }
      process.exit(1);
    }

    // Setup signal handlers
    setupSignalHandlers();

    // Print service URLs
    printServiceUrls();

    // Keep process alive
    log('All services started. Monitoring...', 'DEV');

  } catch (error) {
    logError(`Startup failed: ${error.message}`, 'DEV');
    process.exit(1);
  }
}

// Run main function
main();
