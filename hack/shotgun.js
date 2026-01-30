/** @param {NS} ns
 *
 * Simple "Shotgun" Hacker - Deploy and Forget
 *
 * Run: run shotgun.js [target]
 * Or:  run shotgun.js auto
 */
import { COLORS, getAllServers, scoreTarget } from '/lib/utils.js';

export async function main(ns) {
  const arg = ns.args[0] || 'auto';
  
  ns.disableLog('ALL');
  ns.ui.openTail();

  // Config
  const HOME_RESERVE = 32; // GB to keep free on home
  const LOOP_DELAY = 100;  // ms between checks
  const MONEY_THRESHOLD = 0.80; // threshold of max money in %
  const MIN_DIFFICULTY_BUFFER = 5; // additional buffer for min difficulty
  
  // Deploy workers to all servers first
  const workers = ['/workers/hack.js', '/workers/grow.js', '/workers/weaken.js'];
  for (const server of getAllServers(ns)) {
    if (ns.getServer(server).maxRam > 0 && ns.hasRootAccess(server)) {
      ns.scp(workers, server, 'home');
    }
  }

  while (true) {
    // Pick target
    const target = arg === 'auto' ? findBestTarget(ns) : arg;
    if (!target) {
      ns.print(`${red}ERROR: No valid target${reset}`);
      await ns.sleep(5000);
      continue;
    }

    const server = ns.getServer(target);
    const securityThresh = server.minDifficulty + MIN_DIFFICULTY_BUFFER;
    const moneyThresh = server.moneyMax * MONEY_THRESHOLD;

    // Decide action based on server state
    let action, script, threads;
    
    if (server.hackDifficulty > securityThresh) {
      // Security too high - weaken
      action = 'WEAKEN';
      script = '/workers/weaken.js';
      const needed = Math.ceil((server.hackDifficulty - server.minDifficulty) / 0.05);
      threads = needed;
    } else if (server.moneyAvailable < moneyThresh) {
      // Money too low - grow
      action = 'GROW';
      script = '/workers/grow.js';
      const mult = server.moneyMax / Math.max(server.moneyAvailable, 1);
      threads = Math.ceil(ns.growthAnalyze(target, mult));
    } else {
      // Ready to hack
      action = 'HACK';
      script = '/workers/hack.js';
      threads = Math.max(1, Math.floor((1-MONEY_THRESHOLD) / ns.hackAnalyze(target)));
    }

    // Get available RAM across all servers
    const scriptRam = ns.getScriptRam(script);
    let threadsLaunched = 0;
    let serversUsed = 0;

    for (const hostname of getAllServers(ns)) {
      const srv = ns.getServer(hostname);
      if (!srv.hasAdminRights || srv.maxRam === 0) continue;
      
      const reserve = hostname === 'home' ? HOME_RESERVE : 0;
      const availRam = srv.maxRam - srv.ramUsed - reserve;
      const canRun = Math.floor(availRam / scriptRam);
      
      if (canRun > 0) {
        const pid = ns.exec(script, hostname, canRun, target, 0, Date.now());
        if (pid > 0) {
          threadsLaunched += canRun;
          serversUsed++;
        }
      }
    }

    ns.print(`Using ${serversUsed} servers`);

    // Status update
    const money = ns.formatNumber(server.moneyAvailable);
    const maxMoney = ns.formatNumber(server.moneyMax);
    const sec = server.hackDifficulty.toFixed(1);
    const minSec = server.minDifficulty.toFixed(1);
    
    ns.print(`${target}: $${money}/$${maxMoney} | Sec ${sec}/${minSec} | ${action} x${threadsLaunched}`);

    // Wait for the action to complete before next round
    let waitTime;
    if (action === 'WEAKEN') waitTime = ns.getWeakenTime(target);
    else if (action === 'GROW') waitTime = ns.getGrowTime(target);
    else waitTime = ns.getHackTime(target);

    await ns.sleep(waitTime + 500);
  }
}

function findBestTarget(ns) {
  const player = ns.getPlayer();
  let best = null;
  let bestScore = 0;

  for (const hostname of getAllServers(ns)) {
    const server = ns.getServer(hostname);
    if (!server.hasAdminRights) continue;
    if (server.requiredHackingSkill > player.skills.hacking) continue;
    if (server.moneyMax === 0) continue;
    if (hostname.startsWith('pserv-') || hostname === 'home') continue;

    const score = scoreTarget(ns, hostname);
    if (score > bestScore) {
      bestScore = score;
      best = hostname;
    }
  }
  return best;
}

const { red, green, reset } = COLORS;