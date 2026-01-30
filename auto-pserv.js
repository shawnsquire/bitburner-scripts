/** @param {NS} ns 
 * 
 * Auto Purchase & Upgrade Servers
 * 
 * Fills all server slots, then upgrades smallest servers first.
 * Processes multiple purchases/upgrades per cycle until funds run out.
 * 
 * Run: run auto-pserv.js              (continuous mode)
 *      run auto-pserv.js --single     (one pass, then exit)
 *      run auto-pserv.js --min-ram 64 (minimum RAM threshold)
 *      run auto-pserv.js --reserve 1b (keep $1b in reserve)
 */
export async function main(ns) {
  const FLAGS = ns.flags([
    ["prefix", "pserv"],
    ["min-ram", 8],
    ["single", false],
    ["interval", 10000],
    ["reserve", 0],       // Money to keep in reserve
  ]);

  const C = {
    red: "\u001b[31m",
    green: "\u001b[32m",
    yellow: "\u001b[33m",
    cyan: "\u001b[36m",
    dim: "\u001b[2m",
    reset: "\u001b[0m",
  };

  const prefix = String(FLAGS.prefix);
  const minRam = Number(FLAGS["min-ram"]);
  const loop = !Boolean(FLAGS.single);
  const interval = Number(FLAGS.interval);
  const reserve = Number(FLAGS.reserve);

  const MAX_RAM = ns.getPurchasedServerMaxRam();
  const SERVER_CAP = ns.getPurchasedServerLimit();

  ns.disableLog("ALL");
  if (loop) ns.ui.openTail();

  do {
    let bought = 0;
    let upgraded = 0;

    if (loop) {
      ns.clearLog();
      ns.print(`${C.cyan}═══ Auto Server Manager ═══${C.reset}\n`);
    }

    // === PHASE 1: FILL EMPTY SLOTS ===
    while (ns.getPurchasedServers().length < SERVER_CAP) {
      const budget = ns.getServerMoneyAvailable("home") - reserve;
      const bestRam = getBestAffordableRam(ns, budget, minRam, MAX_RAM);

      if (bestRam <= 0) {
        const needed = ns.getPurchasedServerCost(minRam);
        ns.print(`${C.yellow}WAITING: Need ${ns.formatNumber(needed)} for ${ns.formatRam(minRam)} server${C.reset}`);
        break;
      }

      const cost = ns.getPurchasedServerCost(bestRam);
      const name = `${prefix}-${Date.now().toString(36)}`;
      
      if (ns.purchaseServer(name, bestRam)) {
        ns.print(`${C.green}BOUGHT: ${name} @ ${ns.formatRam(bestRam)} for ${ns.formatNumber(cost)}${C.reset}`);
        bought++;
      } else {
        ns.print(`${C.red}FAILED: Could not purchase ${name}${C.reset}`);
        break;
      }
      await ns.sleep(5);
    }

    // === PHASE 2: UPGRADE SMALLEST SERVERS ===
    if (ns.getPurchasedServers().length >= SERVER_CAP) {
      while (true) {
        const budget = ns.getServerMoneyAvailable("home") - reserve;
        
        // Find the actual smallest server each iteration
        const smallest = ns.getPurchasedServers()
          .map(h => ({ hostname: h, ram: ns.getServerMaxRam(h) }))
          .reduce((min, s) => s.ram < min.ram ? s : min);

        if (smallest.ram >= MAX_RAM) {
          ns.print(`${C.green}ALL MAXED: Every server at ${ns.formatRam(MAX_RAM)}!${C.reset}`);
          break;
        }

        const targetRam = getBestAffordableUpgrade(ns, smallest.hostname, budget, smallest.ram, MAX_RAM);

        if (targetRam <= smallest.ram) {
          const nextRam = smallest.ram * 2;
          const needed = ns.getPurchasedServerUpgradeCost(smallest.hostname, nextRam);
          ns.print(`${C.yellow}WAITING: Need ${ns.formatNumber(needed)} to upgrade ${smallest.hostname}${C.reset}`);
          ns.print(`${C.dim}         (${ns.formatRam(smallest.ram)} → ${ns.formatRam(nextRam)})${C.reset}`);
          break;
        }

        const cost = ns.getPurchasedServerUpgradeCost(smallest.hostname, targetRam);
        
        if (ns.upgradePurchasedServer(smallest.hostname, targetRam)) {
          ns.print(`${C.green}UPGRADED: ${smallest.hostname} ${ns.formatRam(smallest.ram)} → ${ns.formatRam(targetRam)} for ${ns.formatNumber(cost)}${C.reset}`);
          upgraded++;
        } else {
          ns.print(`${C.red}FAILED: Could not upgrade ${smallest.hostname}${C.reset}`);
          break;
        }
        await ns.sleep(5);
      }
    }

    // === STATUS ===
    if (loop) {
      const servers = ns.getPurchasedServers();
      const rams = servers.map(h => ns.getServerMaxRam(h));
      const totalRam = rams.reduce((a, b) => a + b, 0);

      ns.print(`\n${C.dim}───────────────────────────────${C.reset}`);
      ns.print(`Servers: ${servers.length}/${SERVER_CAP}`);
      ns.print(`Total RAM: ${ns.formatRam(totalRam)}`);
      ns.print(`Range: ${ns.formatRam(Math.min(...rams))} – ${ns.formatRam(Math.max(...rams))}`);
      ns.print(`${C.dim}This cycle: ${bought} bought, ${upgraded} upgraded${C.reset}`);
      ns.print(`${C.dim}Next check in ${interval / 1000}s...${C.reset}`);

      await ns.sleep(interval);
    }
  } while (loop);
}

/** Best RAM we can afford for a new server */
function getBestAffordableRam(ns, budget, minRam, maxRam) {
  let best = 0;
  for (let ram = minRam; ram <= maxRam; ram *= 2) {
    if (ns.getPurchasedServerCost(ram) <= budget) best = ram;
    else break;
  }
  return best;
}

/** Best RAM we can upgrade to */
function getBestAffordableUpgrade(ns, hostname, budget, currentRam, maxRam) {
  let best = currentRam;
  for (let ram = currentRam * 2; ram <= maxRam; ram *= 2) {
    if (ns.getPurchasedServerUpgradeCost(hostname, ram) <= budget) best = ram;
    else break;
  }
  return best;
}