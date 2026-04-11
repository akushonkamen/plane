/**
 * Health Check Utilities
 * Provides TCP and HTTP health checking capabilities for service dependencies
 */

const net = require('net');
const http = require('http');

/**
 * Check if a TCP port is available
 * @param {string} host - Host to check
 * @param {number} port - Port to check
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<boolean>} True if port is open
 */
function checkTcpPort(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeout);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Check if an HTTP endpoint responds with expected status
 * @param {string} url - URL to check
 * @param {number} expectedStatus - Expected HTTP status (default: 200)
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<boolean>} True if endpoint responds with expected status
 */
function checkHttpEndpoint(url, expectedStatus = 200, timeout = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeout);

    try {
      const req = http.get(url, (res) => {
        clearTimeout(timer);
        resolve(res.statusCode === expectedStatus);
        req.destroy();
      });

      req.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });

      req.setTimeout(timeout, () => {
        req.destroy();
        resolve(false);
      });
    } catch (error) {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/**
 * Wait for multiple services to become available
 * @param {Array} services - Array of service objects { name, type, host, port, url, expectedStatus }
 * @param {Object} options - Options { timeout: 30000, interval: 1000, showProgress: true }
 * @returns {Promise<Object>} Results with service status and timing
 */
async function waitForServices(services, options = {}) {
  const {
    timeout = 30000,
    interval = 1000,
    showProgress = true
  } = options;

  const startTime = Date.now();
  const results = {};
  const completed = new Set();

  // Initialize results
  for (const service of services) {
    results[service.name] = {
      ready: false,
      attempts: 0,
      duration: 0,
      error: null
    };
  }

  const checkService = async (service) => {
    const serviceStart = Date.now();
    let isReady = false;
    let error = null;

    try {
      if (service.type === 'tcp') {
        isReady = await checkTcpPort(service.host, service.port, 2000);
      } else if (service.type === 'http') {
        isReady = await checkHttpEndpoint(service.url, service.expectedStatus, 2000);
      }
    } catch (err) {
      error = err.message;
    }

    const duration = Date.now() - serviceStart;
    results[service.name] = {
      ready: isReady,
      attempts: results[service.name].attempts + 1,
      duration,
      error
    };

    if (isReady && !completed.has(service.name)) {
      completed.add(service.name);
      if (showProgress) {
        console.log(`  ✓ ${service.name} ready (${duration}ms)`);
      }
    }

    return isReady;
  };

  // Main wait loop
  while (Date.now() - startTime < timeout) {
    const checks = services.map(service => checkService(service));
    await Promise.all(checks);

    if (completed.size === services.length) {
      break;
    }

    // Show progress if enabled
    if (showProgress && completed.size < services.length) {
      const pending = services.filter(s => !completed.has(s.name)).map(s => s.name);
      process.stdout.write(`\r  Waiting: ${pending.join(', ')} `);
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  // Clear progress line
  if (showProgress && completed.size < services.length) {
    console.log();
  }

  return {
    services: results,
    allReady: completed.size === services.length,
    totalDuration: Date.now() - startTime
  };
}

module.exports = {
  checkTcpPort,
  checkHttpEndpoint,
  waitForServices
};
