/**
 * Docker Compose Helper Utilities
 * Provides functions for managing Docker Compose services
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Common Docker binary locations (macOS Docker Desktop, Linux, Homebrew)
const DOCKER_PATHS = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  "/snap/bin/docker",
];

/**
 * Find the docker binary path
 * @returns {string|null} Path to docker binary or null
 */
function findDockerBinary() {
  try {
    return execSync("which docker", { encoding: "utf8" }).trim();
  } catch (_) {
    // Not in PATH, search common locations
    for (const p of DOCKER_PATHS) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
}

/**
 * Get PATH environment with Docker binary directory prepended
 * @returns {string} Modified PATH string
 */
function getDockerEnv() {
  const dockerBin = findDockerBinary();
  if (!dockerBin) return process.env.PATH;
  const dockerDir = path.dirname(dockerBin);
  if (process.env.PATH.includes(dockerDir)) return process.env.PATH;
  return `${dockerDir}:${process.env.PATH}`;
}

/**
 * Execute a command with Docker in PATH
 */
function execWithDocker(cmd, options = {}) {
  const env = { ...process.env, PATH: getDockerEnv() };
  return execSync(cmd, { ...options, env });
}

/**
 * Check if Docker daemon is running
 * @returns {boolean} True if Docker is running
 */
function isDockerRunning() {
  try {
    execWithDocker("docker info > /dev/null 2>&1", { stdio: "ignore" });
    return true;
  } catch (_error) {
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
    execWithDocker("docker compose version > /dev/null 2>&1", { stdio: "ignore" });
    return "docker compose";
  } catch (_error) {
    // Fall back to 'docker-compose' (v1)
    try {
      execWithDocker("docker-compose --version > /dev/null 2>&1", { stdio: "ignore" });
      return "docker-compose";
    } catch (_error2) {
      throw new Error("Neither docker compose nor docker-compose is available. Is Docker Desktop installed?", {
        cause: _error2,
      });
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
    const detachedFlag = detached ? "-d" : "";
    const command = `${cmd} -f ${composeFile} up ${detachedFlag}`;

    const output = execWithDocker(command, {
      encoding: "utf8",
      stdio: "pipe",
    });

    return {
      success: true,
      output,
      command,
    };
  } catch (_error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || "",
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

    const output = execWithDocker(command, {
      encoding: "utf8",
      stdio: "pipe",
    });

    return {
      success: true,
      output,
      command,
    };
  } catch (_error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || "",
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

    const output = execWithDocker(command, {
      encoding: "utf8",
      stdio: "pipe",
    });

    return {
      success: true,
      output,
      command,
    };
  } catch (_error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || "",
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
    const servicePattern = new RegExp(`${serviceName}.*Up`, "i");
    return servicePattern.test(result.output);
  } catch (_error) {
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
    const lines = result.output.split("\n");

    // Skip header line and parse service names
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && line.includes("Up")) {
        // Extract service name (first column)
        const parts = line.split(/\s+/);
        if (parts.length > 0) {
          runningServices.push(parts[0]);
        }
      }
    }

    return runningServices;
  } catch (_error) {
    return [];
  }
}

module.exports = {
  findDockerBinary,
  getDockerEnv,
  isDockerRunning,
  getDockerComposeCommand,
  startServices,
  stopServices,
  getServiceStatus,
  isServiceRunning,
  getRunningServices,
};
