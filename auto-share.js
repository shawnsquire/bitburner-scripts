/** @param {NS} ns
 *
 * Auto Share Manager
 *
 * Continuously monitors for spare RAM across all servers and fills it
 * with share() threads to boost faction reputation gains.
 *
 * Run: run auto-share.js
 *      run auto-share.js --min-free 16   (leave at least 16GB free per server)
 *      run auto-share.js --home-reserve 64
 */
import { COLORS, getAllServers } from '/lib/utils.js';

export async function main(ns) {
  // === FLAGS ===
  const FLAGS = ns.flags([
    ["min-free", 4],        // Minimum GB to leave free on each server
    ["home-reserve", 32],   // GB to reserve on home
    ["interval", 10000],    // Ms between checks
  ]);

  const { red, green, yellow, cyan, white, dim, reset } = COLORS;

  // === CONFIG ===
  const SHARE_SCRIPT = '/workers/share.js';
  const minFree = Number(FLAGS["min-free"]);
  const homeReserve = Number(FLAGS["home-reserve"]);
  const interval = Number(FLAGS.interval);

  ns.disableLog('ALL');
  ns.ui.openTail();

  // Deploy share script to all servers
  await deployShare(ns, SHARE_SCRIPT);

  // Get RAM cost of share script
  const shareRam = ns.getScriptRam(SHARE_SCRIPT);
  if (shareRam === 0) {
    ns.tprint(`${red}ERROR: Could not find ${SHARE_SCRIPT}${reset}`);
    return;
  }

  ns.print(`${cyan}Share script RAM: ${ns.formatRam(shareRam)}${reset}`);

  let totalShareThreads = 0;

  while (true) {
    ns.clearLog();
    
    ns.print(`${cyan}═══ Auto Share Manager ═══${reset}`);
    ns.print(`${dim}Share RAM: ${ns.formatRam(shareRam)} | Min free: ${ns.formatRam(minFree)} | Home reserve: ${ns.formatRam(homeReserve)}${reset}\n`);

    let launchedThisCycle = 0;
    let serversUsed = 0;
    const serverStats = [];

    for (const hostname of getAllServers(ns)) {
      const server = ns.getServer(hostname);
      if (!server.hasAdminRights) continue;
      if (server.maxRam === 0) continue;

      // Calculate available RAM (accounting for reserves)
      const reserve = hostname === 'home' ? homeReserve : minFree;
      const available = server.maxRam - server.ramUsed - reserve;
      
      // How many share threads can we fit?
      const canRun = Math.floor(available / shareRam);

      if (canRun > 0) {
        // Check if share is already running on this server
        const existingShare = ns.ps(hostname).filter(p => p.filename === SHARE_SCRIPT);
        const existingThreads = existingShare.reduce((sum, p) => sum + p.threads, 0);

        // Only launch if we have room for more
        if (canRun > 0) {
          const pid = ns.exec(SHARE_SCRIPT, hostname, canRun, Date.now());
          if (pid > 0) {
            launchedThisCycle += canRun;
            serversUsed++;
            serverStats.push({ hostname, threads: canRun + existingThreads });
          }
        } else if (existingThreads > 0) {
          serverStats.push({ hostname, threads: existingThreads });
        }
      } else {
        // Check for existing share threads even if no room for more
        const existingShare = ns.ps(hostname).filter(p => p.filename === SHARE_SCRIPT);
        const existingThreads = existingShare.reduce((sum, p) => sum + p.threads, 0);
        if (existingThreads > 0) {
          serverStats.push({ hostname, threads: existingThreads });
        }
      }
    }

    // Count total running share threads
    totalShareThreads = 0;
    for (const hostname of getAllServers(ns)) {
      const procs = ns.ps(hostname).filter(p => p.filename === SHARE_SCRIPT);
      totalShareThreads += procs.reduce((sum, p) => sum + p.threads, 0);
    }

    // Calculate share power (each thread = +0.1% to rep gain, roughly)
    const sharePower = ns.getSharePower();

    // Display status
    ns.print(`${white}Active Share Threads: ${green}${totalShareThreads.toLocaleString()}${reset}`);
    ns.print(`${white}Share Power: ${green}${sharePower.toFixed(3)}x${reset} reputation gain`);
    ns.print(`${white}Launched this cycle: ${yellow}${launchedThisCycle.toLocaleString()}${reset} on ${serversUsed} servers`);

    // Show top servers by share threads
    if (serverStats.length > 0) {
      ns.print(`\n${dim}Top servers by share threads:${reset}`);
      serverStats
        .sort((a, b) => b.threads - a.threads)
        .slice(0, 5)
        .forEach(s => {
          ns.print(`  ${dim}${s.hostname.padEnd(20)}${reset} ${s.threads.toLocaleString()} threads`);
        });
    }

    ns.print(`\n${dim}Next check in ${interval / 1000}s...${reset}`);
    await ns.sleep(interval);
  }
}

/** Deploy share script to all servers */
async function deployShare(ns, script) {
  for (const server of getAllServers(ns)) {
    if (ns.getServer(server).maxRam > 0 && ns.hasRootAccess(server)) {
      await ns.scp(script, server, 'home');
    }
  }
}