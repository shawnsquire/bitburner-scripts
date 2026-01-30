/** @param {NS} ns
 *
 * Distributed Multi-Target Hacker
 *
 * Intelligently spreads your RAM across multiple targets simultaneously,
 * calculating optimal thread counts per target to maximize income.
 *
 * Run: run distributed.js
 */
import { COLORS, getAllServers, determineAction } from '/lib/utils.js';

// === WORKER SCRIPTS ===
export const SCRIPTS = {
  hack: '/workers/hack.js',
  grow: '/workers/grow.js',
  weaken: '/workers/weaken.js',
};

export async function main(ns) {
  // === CONFIGURATION ===
  const HOME_RESERVE = 32;           // GB to keep free on home
  const MONEY_THRESHOLD = 0.80;      // Target money % before hacking
  const MIN_DIFFICULTY_BUFFER = 5;   // Security buffer above minimum
  const HACK_PERCENT = 0.25;         // % of money to hack per cycle (0.25 = 25%)
  const MAX_TARGETS = 100;            // Max simultaneous targets
  const LOOP_DELAY = 200;            // ms between status updates while waiting

  const { red, green, yellow, blue, magenta, cyan, white, reset } = COLORS;

  ns.disableLog('ALL');
  ns.ui.openTail();

  // Main loop
  while (true) {
    ns.print(`\n${cyan}════════════════════════════════════════${reset}`);
    ns.print(`${cyan}  DISTRIBUTED HACKER - ${new Date().toLocaleTimeString()}${reset}`);
    ns.print(`${cyan}════════════════════════════════════════${reset}`);

    // Get all usable servers and their RAM
    const servers = getUsableServers(ns, HOME_RESERVE);
    const totalRam = servers.reduce((sum, s) => sum + s.availableRam, 0);
    ns.print(`${white}Total RAM: ${ns.formatRam(totalRam)} across ${servers.length} servers${reset}`);

    // Deploy workers to all servers
    const workers = Object.values(SCRIPTS);
    for (const server of servers) {
      if (!(ns.fileExists(SCRIPTS['hack']) && ns.fileExists['weaken'] && ns.fileExists['grow'])) {
        await ns.scp(workers, server.hostname, 'home');
      }
    }

    // Get and rank targets
    const targets = getTargets(ns, MAX_TARGETS);
    if (targets.length === 0) {
      ns.print(`${red}ERROR: No valid targets found!${reset}`);
      await ns.sleep(5000);
      continue;
    }

    // Determine action needed for each target
    const assignments = [];
    for (const target of targets) {
      const server = ns.getServer(target.hostname);
      const action = determineAction(server, MONEY_THRESHOLD, MIN_DIFFICULTY_BUFFER);
      const optimalThreads = calculateOptimalThreads(ns, target.hostname, action, HACK_PERCENT);
      
      assignments.push({
        hostname: target.hostname,
        action,
        optimalThreads,
        script: SCRIPTS[action],
        scriptRam: ns.getScriptRam(SCRIPTS[action]),
        value: target.value,
        assignedThreads: 0,
        assignedServers: [],
      });
    }

    // Distribute servers to targets
    let serverIndex = 0;
    let allSaturated = false;

    while (serverIndex < servers.length && !allSaturated) {
      allSaturated = true;
      
      for (const assignment of assignments) {
        if (serverIndex >= servers.length) break;
        
        // Skip if this target is saturated (has enough threads)
        if (assignment.assignedThreads >= assignment.optimalThreads) continue;
        
        allSaturated = false;
        const srv = servers[serverIndex];
        const threadsCanRun = Math.floor(srv.availableRam / assignment.scriptRam);
        
        if (threadsCanRun > 0) {
          const threadsToAssign = Math.min(
            threadsCanRun,
            assignment.optimalThreads - assignment.assignedThreads
          );
          
          assignment.assignedServers.push({
            hostname: srv.hostname,
            threads: threadsToAssign,
          });
          assignment.assignedThreads += threadsToAssign;
          
          // Reduce available RAM on this server
          srv.availableRam -= threadsToAssign * assignment.scriptRam;
          
          // If server is depleted, move to next
          if (srv.availableRam < assignment.scriptRam) {
            serverIndex++;
          }
        }
      }

      // Prevent locking up if trying to assign to full server
      const srv = servers[serverIndex];
      const unsaturated = assignments.filter(a => a.assignedThreads < a.optimalThreads);
      if (unsaturated.length > 0 && srv) {
        const smallestRam = Math.min(...unsaturated.map(a => a.scriptRam));
        if (srv.availableRam < smallestRam) {
          serverIndex++;
        }
      }
    }

    // If we still have RAM and all targets are saturated, overflow to best target
    if (serverIndex < servers.length) {
      const bestTarget = assignments[0]; // Highest value target
      while (serverIndex < servers.length) {
        const srv = servers[serverIndex];
        const threadsCanRun = Math.floor(srv.availableRam / bestTarget.scriptRam);
        
        if (threadsCanRun > 0) {
          bestTarget.assignedServers.push({
            hostname: srv.hostname,
            threads: threadsCanRun,
          });
          bestTarget.assignedThreads += threadsCanRun;
        }
        serverIndex++;
      }
    }

    // Execute all assignments
    let longestWait = 0;
    let shortestWait = Number.MAX_SAFE_INTEGER;
    const actionColors = { hack: green, grow: yellow, weaken: blue };

    ns.print(`\n${white}Target Assignments:${reset}`);
    
    for (const assignment of assignments) {
      if (assignment.assignedThreads === 0) continue;

      const color = actionColors[assignment.action];
      const server = ns.getServer(assignment.hostname);
      const money = ns.formatNumber(server.moneyAvailable);
      const maxMoney = ns.formatNumber(server.moneyMax);
      const sec = server.hackDifficulty.toFixed(1);
      const minSec = server.minDifficulty.toFixed(1);
      const saturated = assignment.assignedThreads >= assignment.optimalThreads;
      const satMark = saturated ? `${green}✓${reset}` : `${yellow}~${reset}`;

      ns.print(`  ${color}${assignment.action.toUpperCase().padEnd(6)}${reset} → ${cyan}${assignment.hostname.padEnd(15)}${reset} | ${satMark} ${assignment.assignedThreads.toLocaleString().padStart(10)} threads | $${money}/${maxMoney} | Sec ${sec}/${minSec}`);

      // Launch on all assigned servers
      for (const srv of assignment.assignedServers) {
        ns.exec(assignment.script, srv.hostname, srv.threads, assignment.hostname, 0, Date.now());
      }

      // Track longest wait time
      let waitTime;
      if (assignment.action === 'weaken') waitTime = ns.getWeakenTime(assignment.hostname);
      else if (assignment.action === 'grow') waitTime = ns.getGrowTime(assignment.hostname);
      else waitTime = ns.getHackTime(assignment.hostname);
      
      longestWait = Math.max(longestWait, waitTime);
      shortestWait = Math.min(shortestWait, waitTime);
    }

    const waitTime = Math.max(Math.min(shortestWait, 30000), 1000);

    // Summary
    const totalThreads = assignments.reduce((sum, a) => sum + a.assignedThreads, 0);
    const activeTargets = assignments.filter(a => a.assignedThreads > 0).length;
    ns.print(`\n${magenta}Summary: ${totalThreads.toLocaleString()} threads across ${activeTargets} targets${reset}`);
    ns.print(`${white}Waiting ${ns.tFormat(waitTime)}...${reset}`);

    // Wait with periodic status updates
    await ns.sleep(LOOP_DELAY + waitTime);
  }
}

/** Calculate optimal threads for an action on a target */
function calculateOptimalThreads(ns, hostname, action, hackPercent) {
  const server = ns.getServer(hostname);

  if (action === 'weaken') {
    // Threads to get to min security
    const needed = (server.hackDifficulty - server.minDifficulty) / 0.05;
    return Math.ceil(needed);
  } else if (action === 'grow') {
    // Threads to get to max money
    const growthNeeded = server.moneyMax / Math.max(server.moneyAvailable, 1);
    return Math.ceil(ns.growthAnalyze(hostname, growthNeeded));
  } else {
    // Hack threads for desired percentage
    const hackAnalysis = ns.hackAnalyze(hostname);
    if (hackAnalysis === 0) return 1;
    return Math.max(1, Math.floor(hackPercent / hackAnalysis));
  }
}

/** Get ranked list of hackable targets */
function getTargets(ns, maxTargets) {
  const player = ns.getPlayer();
  const targets = [];

  for (const hostname of getAllServers(ns)) {
    const server = ns.getServer(hostname);
    
    // Skip non-hackable
    if (!server.hasAdminRights) continue;
    if (server.requiredHackingSkill > player.skills.hacking) continue;
    if (server.moneyMax === 0) continue;
    if (hostname.startsWith('pserv-') || hostname === 'home') continue;

    // Score by money potential / time / difficulty
    const hackTime = ns.getHackTime(hostname);
    const value = server.moneyMax / hackTime / server.minDifficulty;

    targets.push({ hostname, value, moneyMax: server.moneyMax });
  }

  // Sort by value descending, take top N
  return targets
    .sort((a, b) => b.value - a.value)
    .slice(0, maxTargets);
}

/** Get all servers with available RAM */
/** @param {NS} ns */
function getUsableServers(ns, homeReserve) {
  const servers = [];

  for (const hostname of getAllServers(ns)) {
    const server = ns.getServer(hostname);
    if (!server.hasAdminRights) continue;
    if (server.maxRam === 0) continue;

    const reserved = hostname === 'home' ? homeReserve : 0;
    const available = server.maxRam - server.ramUsed - reserved;

    if (available > 0) {
      servers.push({
        hostname,
        maxRam: server.maxRam,
        availableRam: available,
      });
    }
  }

  // Sort by RAM descending (assign big servers first)
  return servers.sort((a, b) => b.availableRam - a.availableRam);
}

/** Deploy worker scripts to all servers */
async function deployWorkers(ns, scripts) {
  const workers = Object.values(scripts);
  for (const server of getAllServers(ns)) {
    if (ns.getServer(server).maxRam > 0 && ns.hasRootAccess(server)) {
      await ns.scp(workers, server, 'home');
    }
  }
}