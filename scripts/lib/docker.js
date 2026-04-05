/**
 * Docker Compose Helper Utilities
 * Provides functions for managing Docker Compose services
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Check if Docker daemon is running
 * @returns {boolean} True if Docker is running
 */
function isDockerRunning() {
  try {
    execSync('docker info > /dev/null 2>&1', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get Docker Compose command (docker compose or docker-compose)
 * @returns {string} The appropriate docker compose command
 */
function getDockerComposeCommand() {
  // Try 'docker compose' first (Docker Compose v2)
  try {
    execSync('docker compose version > /dev/null 2>&1', { stdio: 'ignore' });
    return 'docker compose';
  } catch (error) {
    // Fall back to 'docker-compose' (v1)
    try {
      execSync('docker-compose --version > /dev/null 2>&1', { stdio: 'ignore' });
      return 'docker-compose';
    } catch (error2) {
      throw new Error('Neither docker compose nor docker-compose is available');
    }
  }
}

/**
 * Start services from a compose file
 * @param {string} composeFile - Path to docker-compose file
 * @param {boolean} detached - Run in detached mode (default: true)
 * @returns {Object} Result with success status and output
 */
function startServices(composeFile, detached = true) {
  try {
    if (!fs.existsSync(composeFile)) {
      throw new Error(`Compose file not found: ${composeFile}`);
    }

    const cmd = getDockerComposeCommand();
    const detachedFlag = detached ? '-d' : '';
    const command = `${cmd} -f ${composeFile} up ${detachedFlag}`;

    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });

    return {
      success: true,
      output,
      command
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || ''
    };
  }
}

/**
 * Stop services from a compose file
 * @param {string} composeFile - Path to docker-compose file
 * @returns {Object} Result with success status and output
 */
function stopServices(composeFile) {
  try {
    if (!fs.existsSync(composeFile)) {
      throw new Error(`Compose file not found: ${composeFile}`);
    }

    const cmd = getDockerComposeCommand();
    const command = `${cmd} -f ${composeFile} down`;

    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });

    return {
      success: true,
      output,
      command
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || ''
    };
  }
}

/**
 * Get service status from compose file
 * @param {string} composeFile - Path to docker-compose file
 * @returns {Object} Service status information
 */
function getServiceStatus(composeFile) {
  try {
    if (!fs.existsSync(composeFile)) {
      throw new Error(`Compose file not found: ${composeFile}`);
    }

    const cmd = getDockerComposeCommand();
    const command = `${cmd} -f ${composeFile} ps`;

    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });

    return {
      success: true,
      output,
      command
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || ''
    };
  }
}

/**
 * Check if a specific service is running
 * @param {string} composeFile - Path to docker-compose file
 * @param {string} serviceName - Name of the service to check
 * @returns {boolean} True if service is running
 */
function isServiceRunning(composeFile, serviceName) {
  try {
    const result = getServiceStatus(composeFile);

    if (!result.success) {
      return false;
    }

    // Check if service name appears in the output with "Up" status
    const servicePattern = new RegExp(`${serviceName}.*Up`, 'i');
    return servicePattern.test(result.output);
  } catch (error) {
    return false;
  }
}

/**
 * Get list of running services from compose file
 * @param {string} composeFile - Path to docker-compose file
 * @returns {Array} List of running service names
 */
function getRunningServices(composeFile) {
  try {
    const result = getServiceStatus(composeFile);

    if (!result.success) {
      return [];
    }

    const runningServices = [];
    const lines = result.output.split('\n');

    // Skip header line and parse service names
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && line.includes('Up')) {
        // Extract service name (first column)
        const parts = line.split(/\s+/);
        if (parts.length > 0) {
          runningServices.push(parts[0]);
        }
      }
    }

    return runningServices;
  } catch (error) {
    return [];
  }
}

module.exports = {
  isDockerRunning,
  getDockerComposeCommand,
  startServices,
  stopServices,
  getServiceStatus,
  isServiceRunning,
  getRunningServices
};
