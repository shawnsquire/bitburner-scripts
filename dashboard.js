/** @param {NS} ns
 *
 * Dashboard Monitor
 *
 * Real-time view of all hacking activity across your network.
 * Run separately from your hacking scripts.
 *
 * Features:
 * - Money and security status per target
 * - Thread counts for hack/grow/weaken
 * - Expected income with timing
 *
 * Run: run dashboard.js
 */
import { COLORS, getAllServers, makeBar, discoverAllWithDepthAndPath, pathToArray } from '/lib/utils.js';

export async function main(ns) {
  // === CONFIGURATION ===
  const REFRESH_RATE = 1000;  // ms between refreshes

  const { red, green, yellow, blue, magenta, cyan, white, dim, reset } = COLORS;

  ns.disableLog('ALL');
  ns.ui.openTail();
  ns.ui.resizeTail(820, 650);

  const startTime = Date.now();
  let lastMoney = ns.getPlayer().money;

  while (true) {

    ns.clearLog();

    const player = ns.getPlayer();
    const uptime = Date.now() - startTime;
    const moneyGained = player.money - lastMoney;

    // Pre-compute paths for clickable links
    const { parentByHost } = discoverAllWithDepthAndPath(ns, 'home', 100);

    // === HEADER ===
    const TITLE = 'NETWORK DASHBOARD';
    const HEADER_WIDTH = 50;
    ns.print(`${cyan}${'═'.repeat(50)}${reset}`);
    ns.print(`${' '.repeat((HEADER_WIDTH-TITLE.length)/2)}${white}${TITLE}${reset}`);
    ns.print(`${cyan}${'═'.repeat(50)}${reset}`);
    ns.print(`${dim}Uptime: ${ns.tFormat(uptime)} | Money: ${ns.formatNumber(player.money)} (${moneyGained >= 0 ? green + '+' : red}${ns.formatNumber(moneyGained)}${reset}${dim}/s)${reset}`);

    // === RAM USAGE ===
    const ramStats = getRamStats(ns);
    const ramPercent = ((ramStats.used / ramStats.total) * 100).toFixed(1);
    const ramBar = makeBar(ramStats.used / ramStats.total, 20);
    ns.print(`\n${white}RAM Usage:${reset} ${ramBar} ${ramPercent}% (${ns.formatRam(ramStats.used)}/${ns.formatRam(ramStats.total)})`);
    ns.print(`${dim}Servers: ${ramStats.activeServers}/${ramStats.totalServers} active${reset}`);

    // === CATEGORIZE SERVERS ===
    const jobs = getRunningJobs(ns);
    const allServers = getHackableServers(ns);
    const playerHacking = player.skills.hacking;

    // Categorize servers
    const needHigherLevel = [];  // Can't hack - level too low
    const needPorts = [];        // Have level, need ports
    const canHack = [];          // Have root access

    for (const hostname of allServers) {
      const server = ns.getServer(hostname);
      if (server.hasAdminRights) {
        canHack.push(hostname);
      } else if (server.requiredHackingSkill > playerHacking) {
        needHigherLevel.push(hostname);
      } else {
        needPorts.push(hostname);
      }
    }

    // Sort canHack by hack level (easiest first), take top 10
    canHack.sort((a, b) => ns.getServer(b).moneyMax - ns.getServer(a).moneyMax);
    const top10 = canHack.slice(0, 10);
    const remaining = canHack.slice(10);

    // Header row
    ns.print(`\n${dim}${'Target'.padEnd(18)} ${'$%'.padStart(5)} ${'Sec'.padStart(5)} ${'Hack'.padStart(7)} ${'Grow'.padStart(7)} ${'Wkn'.padStart(7)}   ${'Expected'}${reset}`);
    ns.print(`${dim}${'─'.repeat(78)}${reset}`);

    let totalHack = 0, totalGrow = 0, totalWeaken = 0, totalExpected = 0;
    let idleCount = 0;

    // Show top 10 rooted servers
    for (const hostname of top10) {
      const result = renderServerRow(ns, hostname, jobs[hostname]);
      totalHack += result.hack;
      totalGrow += result.grow;
      totalWeaken += result.weaken;
      totalExpected += result.expected;
      if (result.idle) idleCount++;
    }

    // Show servers needing ports (have level, no root)
    for (const hostname of needPorts) {
      const server = ns.getServer(hostname);
      const portsHave = server.openPortCount;
      const portsNeeded = server.numOpenPortsRequired;
      ns.print(`${dim}${hostname.padEnd(18)}${reset} ${yellow}🔒${reset} ${dim}${portsHave}/${portsNeeded} ports${reset}`);
    }

    // Summarize remaining rooted servers
    let remainingActive = 0;
    let remainingIdle = 0;
    let remainingExpected = 0;

    for (const hostname of remaining) {
      const actions = jobs[hostname] || { hack: 0, grow: 0, weaken: 0 };
      const isActive = (actions.hack + actions.grow + actions.weaken) > 0;

      if (isActive) {
        remainingActive++;
        totalHack += actions.hack;
        totalGrow += actions.grow;
        totalWeaken += actions.weaken;
        const exp = calcExpectedMoney(ns, hostname, actions.hack);
        totalExpected += exp;
        remainingExpected += exp;
      } else {
        remainingIdle++;
        idleCount++;
      }
    }

    if (remainingActive > 0) {
      ns.print(`${dim}... +${remainingActive} more active${reset} ${' '.repeat(38)} ${green}$${ns.formatNumber(remainingExpected)}${reset}`);
    }

    // Totals
    ns.print(`${dim}${'─'.repeat(78)}${reset}`);
    ns.print(`${white}${'TOTAL'.padEnd(18)}${reset} ${' '.repeat(12)} ${green}${totalHack.toLocaleString().padStart(7)}${reset} ${yellow}${totalGrow.toLocaleString().padStart(7)}${reset} ${blue}${totalWeaken.toLocaleString().padStart(7)}${reset}   ${green}$${ns.formatNumber(totalExpected)}${reset}`);

    // Summary footer
    const summaryParts = [];
    if (idleCount > 0) summaryParts.push(`${yellow}${idleCount} idle${reset}`);
    if (needHigherLevel.length > 0) {
      const nextLevel = Math.min(...needHigherLevel.map(h => ns.getServer(h).requiredHackingSkill));
      summaryParts.push(`${red}${needHigherLevel.length} need higher hack${reset} ${dim}(next: ${nextLevel})${reset}`);
    }
    if (summaryParts.length > 0) {
      ns.print(`${dim}${summaryParts.join(' | ')}${reset}`)
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

/** Render a server row and return stats */
function renderServerRow(ns, hostname, actions) {
  const { red, green, yellow, blue, cyan, gray, dim, reset } = COLORS;

  actions = actions || { hack: 0, grow: 0, weaken: 0, earliestCompletion: null };
  const server = ns.getServer(hostname);
  const isActive = (actions.hack + actions.grow + actions.weaken) > 0;

  // Calculate expected money
  const expectedMoney = calcExpectedMoney(ns, hostname, actions.hack);

  // Money percentage
  const moneyPct = server.moneyMax > 0 ? (server.moneyAvailable / server.moneyMax) * 100 : 0;
  const moneyColor = moneyPct >= 80 ? green : moneyPct >= 50 ? yellow : red;
  const moneyStr = `${moneyColor}${moneyPct.toFixed(0).padStart(4)}%${reset}`;

  // Security delta
  const secDiff = server.hackDifficulty - server.minDifficulty;
  const secColor = secDiff <= 2 ? green : secDiff <= 5 ? yellow : red;
  const secStr = `${secColor}${('+' + secDiff.toFixed(0)).padStart(5)}${reset}`;

  // Thread counts
  const hackStr = actions.hack > 0
    ? `${green}${actions.hack.toLocaleString().padStart(7)}${reset}`
    : `${gray}${actions.hack.toLocaleString().padStart(7)}${reset}`;
  const growStr = actions.grow > 0
    ? `${yellow}${actions.grow.toLocaleString().padStart(7)}${reset}`
    : `${gray}${actions.grow.toLocaleString().padStart(7)}${reset}`;
  const weakenStr = actions.weaken > 0
    ? `${blue}${actions.weaken.toLocaleString().padStart(7)}${reset}`
    : `${gray}${actions.weaken.toLocaleString().padStart(7)}${reset}`;

  // Expected money + timing
  const expectedStr = formatExpected(ns, expectedMoney, actions.earliestCompletion);

  // Highlight active targets
  const nameColor = isActive ? cyan : gray;
  ns.print(`${nameColor}${hostname.padEnd(18)}${reset} ${moneyStr} ${secStr} ${hackStr} ${growStr} ${weakenStr}   ${expectedStr}`);

  return {
    hack: actions.hack,
    grow: actions.grow,
    weaken: actions.weaken,
    expected: expectedMoney,
    idle: !isActive
  };
}

/** Format expected money with timing */
function formatExpected(ns, expectedMoney, earliestCompletion) {
  const { green, yellow, cyan, dim, reset } = COLORS;

  if (expectedMoney <= 0) {
    // No hack threads, show prep status
    if (earliestCompletion && earliestCompletion > Date.now()) {
      const timeStr = ns.tFormat(earliestCompletion - Date.now(), false);
      return `${dim}prep${reset} ${yellow}${timeStr}${reset}`;
    }
    return `${dim}preparing...${reset}`;
  }

  const moneyStr = `${green}$${ns.formatNumber(expectedMoney)}${reset}`;

  if (earliestCompletion && earliestCompletion > Date.now()) {
    const timeRemaining = earliestCompletion - Date.now();
    const timeStr = ns.tFormat(timeRemaining, false);
    const timeColor = timeRemaining < 5000 ? cyan : timeRemaining < 30000 ? yellow : dim;
    return `${moneyStr} ${dim}→${reset} ${timeColor}${timeStr}${reset}`;
  }

  return `${moneyStr} ${dim}→ soon${reset}`;
}

/** Get all hackable servers (have money, not special), sorted alphabetically */
function getHackableServers(ns) {
  const servers = [];

  for (const hostname of getAllServers(ns)) {
    // Skip home and purchased servers
    if (hostname === 'home' || hostname.startsWith('pserv-')) continue;

    const server = ns.getServer(hostname);

    // Skip servers with no money (not hackable targets)
    if (server.moneyMax === 0) continue;

    servers.push(hostname);
  }

  return servers.sort((a, b) => a.localeCompare(b));
}

/** Calculate expected money for a target from hack threads */
function calcExpectedMoney(ns, target, hackThreads) {
  if (hackThreads <= 0) return 0;

  const server = ns.getServer(target);
  const hackPercent = ns.hackAnalyze(target) * hackThreads;
  const hackChance = ns.hackAnalyzeChance(target);
  return server.moneyAvailable * Math.min(hackPercent, 1) * hackChance;
}

/** Get all running hacking jobs grouped by target with timing info */
function getRunningJobs(ns) {
  const jobs = {};

  for (const hostname of getAllServers(ns)) {
    for (const proc of ns.ps(hostname)) {
      if (!['workers/hack.js', 'workers/grow.js', 'workers/weaken.js'].includes(proc.filename)) continue;

      const target = proc.args[0];
      if (!target) continue;

      const action = proc.filename.split('/').pop().replace('.js', '');
      const delay = proc.args[1] || 0;
      const launchTime = proc.args[2]; // Date.now() passed when launched

      if (!jobs[target]) {
        jobs[target] = { hack: 0, grow: 0, weaken: 0, earliestCompletion: null, expectedMoney: 0 };
      }
      jobs[target][action] += proc.threads;

      // Calculate completion time if we have launch time
      if (launchTime && typeof launchTime === 'number') {
        let duration;
        if (action === 'hack') duration = ns.getHackTime(target);
        else if (action === 'grow') duration = ns.getGrowTime(target);
        else duration = ns.getWeakenTime(target);

        const completionTime = launchTime + delay + duration;

        // Track earliest completion
        if (jobs[target].earliestCompletion === null || completionTime < jobs[target].earliestCompletion) {
          jobs[target].earliestCompletion = completionTime;
        }
      }
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
