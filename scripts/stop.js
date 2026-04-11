#!/usr/bin/env node

/**
 * Plane Development Environment Cleanup Script
 * Stops Docker services and cleans up background processes
 */

const fs = require('fs');
const path = require('path');
const { stopServices } = require('./lib/docker');

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

// Kill a process gracefully
function killProcess(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    // Process might not exist, that's okay
    return false;
  }
}

// Clean up PID files and kill processes
function cleanupBackgroundProcesses() {
  logStep('1/2', 'Cleaning up background processes...');

  const pidDir = path.join(__dirname, '.pids');
  let cleanedCount = 0;

  if (!fs.existsSync(pidDir)) {
    logSuccess('No background processes to clean up');
    return;
  }

  const files = fs.readdirSync(pidDir);

  for (const file of files) {
    if (file.endsWith('.pid')) {
      const pidFile = path.join(pidDir, file);
      const serviceName = file.replace('.pid', '').toUpperCase();

      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());

        if (!isNaN(pid)) {
          // Try to kill the process gracefully
          let killed = false;
          try {
            // Check if process exists
            process.kill(pid, 0);
            process.kill(pid, 'SIGTERM');
            killed = true;

            // Wait a moment for graceful shutdown
            const start = Date.now();
            while (Date.now() - start < 2000) {
              try {
                process.kill(pid, 0);
              } catch (e) {
                // Process is gone
                break;
              }
            }

            // Force kill if still running
            try {
              process.kill(pid, 0);
              process.kill(pid, 'SIGKILL');
            } catch (e) {
              // Process is gone
            }
          } catch (error) {
            // Process doesn't exist, just clean up the file
          }

          if (killed) {
            logSuccess(`Stopped ${serviceName} (PID: ${pid})`);
          } else {
            logWarning(`Cleaned up ${serviceName} PID file (process not running)`);
          }
          cleanedCount++;
        }

        // Remove the PID file
        fs.unlinkSync(pidFile);
      } catch (error) {
        logError(`Failed to clean up ${serviceName}: ${error.message}`);
      }
    }
  }

  if (cleanedCount === 0) {
    logSuccess('No background processes to clean up');
  }

  // Try to remove the PID directory
  try {
    const remainingFiles = fs.readdirSync(pidDir);
    if (remainingFiles.length === 0) {
      fs.rmdirSync(pidDir);
    }
  } catch (error) {
    // Directory might not be empty or have permission issues
  }
}

// Stop Docker Compose services
function stopDockerServices() {
  logStep('2/2', 'Stopping Docker services...');

  const composeFile = path.resolve(__dirname, '..', 'docker-compose-local.yml');

  if (!fs.existsSync(composeFile)) {
    logWarning('docker-compose-local.yml not found, skipping Docker cleanup');
    return;
  }

  const result = stopServices(composeFile);

  if (result.success) {
    logSuccess('Docker services stopped');
  } else {
    // Try to provide more helpful error message
    if (result.error && result.error.includes('command not found')) {
      logError('Docker Compose not found. Please install Docker Compose.');
    } else if (result.error && result.error.includes('connect')) {
      logError('Cannot connect to Docker daemon. Please ensure Docker is running.');
    } else {
      logError(`Failed to stop Docker services: ${result.error}`);
    }
  }
}

// Print completion message
function printCompletion() {
  log('\n' + '='.repeat(70));
  log(colors.bright + colors.green + 'Cleanup completed!' + colors.reset);
  log('='.repeat(70) + '\n');
  log('All development services have been stopped.');
  log('To start again, run: npm run dev:full\n');
}

// Main execution
function main() {
  log(colors.bright + colors.cyan);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('                   Stopping Plane Development Environment');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(colors.reset);

  try {
    cleanupBackgroundProcesses();
    stopDockerServices();
    printCompletion();
  } catch (error) {
    logError(`Cleanup failed: ${error.message}`);
    process.exit(1);
  }
}

// Run main function
main();
