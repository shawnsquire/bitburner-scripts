/**
 * Shared utilities for Bitburner scripts
 *
 * Import with: import { COLORS, getAllServers, ... } from '/lib/utils.js';
 */

// === ANSI COLORS ===
export const COLORS = {
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  white: "\u001b[37m",
  dim: "\u001b[2m",
  gray: "\u001b[30m",
  bold: "\u001b[1m",
  reset: "\u001b[0m",
};

// === SERVER DISCOVERY ===

/**
 * Get all servers via BFS from home
 * @param {NS} ns
 * @returns {string[]} Array of all server hostnames
 */
export function getAllServers(ns) {
  const servers = new Set(['home']);
  const queue = ['home'];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of ns.scan(current)) {
      if (!servers.has(neighbor)) {
        servers.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return [...servers];
}

/**
 * Discover all servers with depth and parent tracking for path reconstruction
 * @param {NS} ns
 * @param {string} start - Starting server hostname
 * @param {number} maxDepth - Maximum depth to search (-1 for unlimited)
 * @returns {{ hosts: string[], depthByHost: Map<string, number>, parentByHost: Map<string, string|null> }}
 */
export function discoverAllWithDepthAndPath(ns, start, maxDepth) {
  const depthByHost = new Map([[start, 0]]);
  const parentByHost = new Map([[start, null]]);
  const q = [start];

  while (q.length) {
    const cur = q.shift();
    const curDepth = depthByHost.get(cur);

    for (const n of ns.scan(cur)) {
      const candDepth = curDepth + 1;
      const prevDepth = depthByHost.get(n);

      if (prevDepth === undefined || candDepth < prevDepth) {
        depthByHost.set(n, candDepth);
        parentByHost.set(n, cur);

        if (maxDepth < 0 || curDepth + 1 < maxDepth)
          q.push(n);
      }
    }
  }

  const hosts = [...depthByHost.keys()].sort((a, b) => {
    const da = depthByHost.get(a);
    const db = depthByHost.get(b);
    return da - db || a.localeCompare(b);
  });

  return { hosts, depthByHost, parentByHost };
}

/**
 * Reconstruct path from parent map
 * @param {Map<string, string|null>} parentByHost - Parent map from discoverAllWithDepthAndPath
 * @param {string} target - Target server hostname
 * @param {boolean} [includeStart=false] - Whether to include the start node
 * @returns {string} Path as "home > server1 > server2" or similar
 */
export function pathTo(parentByHost, target, includeStart = false) {
  const reversed = pathToArray(parentByHost, target);
  return includeStart ? reversed.join(" > ") : reversed.slice(1).join(" > ");
}

/**
 * Get array of hostnames in path from start to target
 * @param {Map<string, string|null>} parentByHost
 * @param {string} target
 * @returns {string[]} Array of hostnames from start to target
 */
export function pathToArray(parentByHost, target) {
  const path = [];
  let cur = target;

  while (cur !== null && cur !== undefined) {
    path.push(cur);
    cur = parentByHost.get(cur);
  }

  return path.reverse();
}

// === HACKING UTILITIES ===

/**
 * Determine what action a server needs (weaken/grow/hack)
 * @param {Server} server - Server object from ns.getServer()
 * @param {number} moneyThreshold - Fraction of max money before hacking (e.g., 0.80)
 * @param {number} securityBuffer - Security buffer above minimum (e.g., 5)
 * @returns {'weaken' | 'grow' | 'hack'}
 */
export function determineAction(server, moneyThreshold, securityBuffer) {
  const securityThresh = server.minDifficulty + securityBuffer;
  const moneyThresh = server.moneyMax * moneyThreshold;

  if (server.hackDifficulty > securityThresh) {
    return 'weaken';
  } else if (server.moneyAvailable < moneyThresh) {
    return 'grow';
  } else {
    return 'hack';
  }
}

/**
 * Score a target for hacking priority
 * Higher is better: moneyMax / hackTime / minDifficulty
 * @param {NS} ns
 * @param {string} hostname
 * @returns {number}
 */
export function scoreTarget(ns, hostname) {
  const server = ns.getServer(hostname);
  const hackTime = ns.getHackTime(hostname);
  return server.moneyMax / hackTime / server.minDifficulty;
}

// === DISPLAY UTILITIES ===

/**
 * Make a simple progress bar
 * @param {number} percent - Value between 0 and 1
 * @param {number} width - Width in characters
 * @param {string} [fillColor] - ANSI color for filled portion (default green)
 * @returns {string} Bar like "[████░░░░]"
 */
export function makeBar(percent, width, fillColor = COLORS.green) {
  const filled = Math.round(Math.min(1, Math.max(0, percent)) * width);
  const empty = width - filled;
  return `[${fillColor}${'█'.repeat(filled)}${COLORS.reset}${COLORS.dim}${'░'.repeat(empty)}${COLORS.reset}]`;
}

/**
 * Make a timing progress bar that shows time remaining
 * @param {number} progress - Progress value between 0 and 1
 * @param {number} width - Width of the bar portion
 * @param {number} timeRemaining - Time remaining in ms
 * @param {NS} ns - For formatting
 * @returns {string} Bar with time like "[████░░] 12s"
 */
export function makeTimingBar(progress, width, timeRemaining, ns) {
  const bar = makeBar(progress, width, COLORS.cyan);
  const timeStr = timeRemaining > 0 ? ns.tFormat(timeRemaining, true) : 'done';
  return `${bar} ${timeStr}`;
}

/**
 * Format a number with SI suffixes (k, m, b, t, q)
 * @param {number} n
 * @returns {string}
 */
export function formatNum(n) {
  if (!isFinite(n)) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e15) return `${sign}${(abs / 1e15).toFixed(2)}q`;
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}t`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}k`;
  return `${sign}${abs.toFixed(0)}`;
}

/**
 * Format RAM with appropriate units
 * @param {number} gb - RAM in GB
 * @returns {string}
 */
export function formatRam(gb) {
  if (!isFinite(gb)) return "-";
  if (gb >= 1024) return `${(gb / 1024).toFixed(0)}TB`;
  if (gb >= 1) return `${gb.toFixed(0)}GB`;
  if (gb > 0) return `${(gb * 1024).toFixed(0)}MB`;
  return "0GB";
}
