/** @param {NS} ns 
 * 
 * Dashboard Monitor
 * 
 * Real-time view of all hacking activity across your network.
 * Run separately from your hacking scripts.
 * 
 * Run: run dashboard.js
 */
export async function main(ns) {
  // === CONFIGURATION ===
  const REFRESH_RATE = 1000;  // ms between refreshes

  // === ANSI COLORS ===
  const red = "\u001b[31m";
  const green = "\u001b[32m";
  const yellow = "\u001b[33m";
  const blue = "\u001b[34m";
  const magenta = "\u001b[35m";
  const cyan = "\u001b[36m";
  const white = "\u001b[37m";
  const dim = "\u001b[2m";
  const reset = "\u001b[0m";

  ns.disableLog('ALL');
  ns.ui.openTail();
  ns.ui.resizeTail(650, 750);

  const startTime = Date.now();
  let lastMoney = ns.getPlayer().money;

  while (true) {

    ns.clearLog();

    const player = ns.getPlayer();
    const uptime = Date.now() - startTime;
    const moneyGained = player.money - lastMoney;

    // === HEADER ===
    ns.print(`${cyan}╔════════════════════════════════════════════════════╗${reset}`);
    ns.print(`${cyan}║${reset}          ${white}NETWORK DASHBOARD${reset}                         ${cyan}║${reset}`);
    ns.print(`${cyan}╚════════════════════════════════════════════════════╝${reset}`);
    ns.print(`${dim}Uptime: ${ns.tFormat(uptime)} | Money: ${ns.formatNumber(player.money)} (${moneyGained >= 0 ? green + '+' : red}${ns.formatNumber(moneyGained)}${reset}${dim}/s)${reset}`);

    // === RAM USAGE ===
    const ramStats = getRamStats(ns);
    const ramPercent = ((ramStats.used / ramStats.total) * 100).toFixed(1);
    const ramBar = makeBar(ramStats.used / ramStats.total, 20);
    ns.print(`\n${white}RAM Usage:${reset} ${ramBar} ${ramPercent}% (${ns.formatRam(ramStats.used)}/${ns.formatRam(ramStats.total)})`);
    ns.print(`${dim}Servers: ${ramStats.activeServers}/${ramStats.totalServers} active${reset}`);

    // === RUNNING JOBS ===
    const jobs = getRunningJobs(ns);
    const jobList = Object.entries(jobs).sort((a, b) => {
      const totalA = a[1].hack + a[1].grow + a[1].weaken;
      const totalB = b[1].hack + b[1].grow + b[1].weaken;
      return totalB - totalA;
    });

    ns.print(`\n${white}Active Targets:${reset}`);

    if (jobList.length === 0) {
      ns.print(`  ${yellow}No hacking activity detected${reset}`);
    } else {
      // Header row
      ns.print(`  ${dim}${'Target'.padEnd(16)} ${'Hack'.padStart(10)} ${'Grow'.padStart(10)} ${'Weaken'.padStart(10)} ${'Status'.padStart(10)}${reset}`);
      ns.print(`  ${dim}${'─'.repeat(60)}${reset}`);

      for (const [target, actions] of jobList) {
        const server = ns.getServer(target);
        const moneyPct = ((server.moneyAvailable / server.moneyMax) * 100).toFixed(0);
        const secDiff = server.hackDifficulty - server.minDifficulty;

        // Color-code status
        let statusText;
        let statusColor;
        if (secDiff > 5) {
          statusText = `Sec +${secDiff.toFixed(0)}`;
          statusColor = red;
        } else if (server.moneyAvailable < server.moneyMax * 0.8) {
          statusText = `${moneyPct}% $`;
          statusColor = yellow;
        } else {
          statusText = `Ready`;
          statusColor = green;
        }
        const status = `${statusColor}${statusText.padStart(10)}${reset}`;

        const hackNum = actions.hack.toLocaleString().padStart(10);
        const growNum = actions.grow.toLocaleString().padStart(10);
        const weakenNum = actions.weaken.toLocaleString().padStart(10);

        const hackStr = actions.hack > 0 ? `${green}${hackNum}${reset}` : `${dim}${hackNum}${reset}`;
        const growStr = actions.grow > 0 ? `${yellow}${growNum}${reset}` : `${dim}${growNum}${reset}`;
        const weakenStr = actions.weaken > 0 ? `${blue}${weakenNum}${reset}` : `${dim}${weakenNum}${reset}`;

        ns.print(`  ${cyan}${target.padEnd(16)}${reset} ${hackStr} ${growStr} ${weakenStr} ${status}`);

      }

      // Totals
      const totalHack = jobList.reduce((sum, [_, a]) => sum + a.hack, 0);
      const totalGrow = jobList.reduce((sum, [_, a]) => sum + a.grow, 0);
      const totalWeaken = jobList.reduce((sum, [_, a]) => sum + a.weaken, 0);
      const totalThreads = totalHack + totalGrow + totalWeaken;
      const expectedMoney = getExpectedMoney(ns, jobs);

      ns.print(`  ${dim}${'─'.repeat(60)}${reset}`);
      ns.print(`  ${white}${'TOTAL'.padEnd(16)}${reset} ${green}${totalHack.toLocaleString().padStart(10)}${reset} ${yellow}${totalGrow.toLocaleString().padStart(10)}${reset} ${blue}${totalWeaken.toLocaleString().padStart(10)}${reset}`);
      ns.print(`\n${magenta}Total Threads: ${totalThreads.toLocaleString()} | Expecting: ${green}$${ns.formatNumber(expectedMoney)}${reset}`);
    }

    // === SERVER BREAKDOWN (optional, shows top 5 busiest) ===
    const serverJobs = getServerJobCounts(ns);
    const topServers = serverJobs.slice(0, 5);

    if (topServers.length > 0) {
      ns.print(`\n${white}Busiest Servers:${reset}`);
      for (const srv of topServers) {
        const bar = makeBar(srv.threads / (topServers[0].threads || 1), 10);
        ns.print(`  ${dim}${srv.hostname.padEnd(20)}${reset} ${bar} ${srv.threads.toLocaleString()} threads`);
      }
    }

    lastMoney = player.money;
    await ns.sleep(REFRESH_RATE);
  }
}

/** Get all running hacking jobs grouped by target */
function getRunningJobs(ns) {
  const jobs = {};

  for (const hostname of getAllServers(ns)) {
    for (const proc of ns.ps(hostname)) {
      if (!['workers/hack.js', 'workers/grow.js', 'workers/weaken.js'].includes(proc.filename)) continue;

      const target = proc.args[0];
      if (!target) continue;

      const action = proc.filename.split('/').pop().replace('.js', '');

      if (!jobs[target]) {
        jobs[target] = { hack: 0, grow: 0, weaken: 0 };
      }
      jobs[target][action] += proc.threads;
    }
  }

  return jobs;
}

/** Get job counts per server */
function getServerJobCounts(ns) {
  const servers = [];

  for (const hostname of getAllServers(ns)) {
    let threads = 0;
    for (const proc of ns.ps(hostname)) {
      if (proc.filename.includes('/workers/')) {
        threads += proc.threads;
      }
    }
    if (threads > 0) {
      servers.push({ hostname, threads });
    }
  }

  return servers.sort((a, b) => b.threads - a.threads);
}

/** Get RAM stats across all servers */
function getRamStats(ns) {
  let total = 0;
  let used = 0;
  let activeServers = 0;
  let totalServers = 0;

  for (const hostname of getAllServers(ns)) {
    const server = ns.getServer(hostname);
    if (!server.hasAdminRights || server.maxRam === 0) continue;

    totalServers++;
    total += server.maxRam;
    used += server.ramUsed;

    if (server.ramUsed > 0) activeServers++;
  }

  return { total, used, activeServers, totalServers };
}

/** Get all servers via recursive scan */
function getAllServers(ns) {
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

/** Make a simple progress bar */
function makeBar(percent, width) {
  const filled = Math.round(percent * width);
  const empty = width - filled;
  return `[${'\u001b[32m'}${'█'.repeat(filled)}${'\u001b[0m'}${'\u001b[2m'}${'░'.repeat(empty)}${'\u001b[0m'}]`;
}

/** Calculate expected money from running hack threads */
function getExpectedMoney(ns, jobs) {
  let expected = 0;
  
  for (const [target, actions] of Object.entries(jobs)) {
    if (actions.hack > 0) {
      const server = ns.getServer(target);
      const hackPercent = ns.hackAnalyze(target) * actions.hack;
      const hackChance = ns.hackAnalyzeChance(target);
      expected += server.moneyAvailable * Math.min(hackPercent, 1) * hackChance;
    }
  }
  
  return expected;
}