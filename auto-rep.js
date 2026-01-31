/** @param {NS} ns
 *
 * Auto Reputation Manager
 *
 * Automatically manages faction reputation grinding:
 * - Finds the faction with the next available augmentation
 * - Switches to optimal method of gaining rep
 * - Displays progress dashboard with ETA
 * - Shows recommended augmentation purchase priority
 *
 * Requires Singularity API (SF4)
 *
 * Run: run auto-rep.js
 *      run auto-rep.js --faction CyberSec   (target specific faction)
 *      run auto-rep.js --no-work            (dashboard only, don't auto-work)
 */
import { COLORS, makeBar, formatNum } from '/lib/utils.js';

// Augmentation cost multiplier after each purchase
const AUG_COST_MULT = 1.9;

export async function main(ns) {
  const FLAGS = ns.flags([
    ["faction", ""],        // Target specific faction (empty = auto-select)
    ["no-work", false],     // Don't auto-work, just display
    ["interval", 2000],     // Refresh interval in ms
    ["reserve", 0],         // Money to reserve (won't count toward affordability)
  ]);

  const { red, green, yellow, blue, cyan, magenta, white, dim, reset } = COLORS;

  ns.disableLog('ALL');
  ns.ui.openTail();
  ns.ui.resizeTail(900, 700);

  // Track rep gain rate
  let lastRep = 0;
  let lastRepTime = Date.now();
  let repGainRate = 0;
  let lastTargetFaction = '';

  while (true) {
    ns.clearLog();

    const player = ns.getPlayer();
    const ownedAugs = ns.singularity.getOwnedAugmentations(true); // includes purchased
    const installedAugs = ns.singularity.getOwnedAugmentations(false);
    const pendingAugs = ownedAugs.filter(a => !installedAugs.includes(a));

    // Get all faction data
    const factionData = analyzeFactions(ns, player, ownedAugs);

    // Find next augmentation (smallest rep gap across all factions)
    let nextTarget = findNextAugmentation(factionData);

    // Override with specific faction if requested
    if (FLAGS.faction) {
      const forcedFaction = factionData.find(f => f.name === FLAGS.faction);
      if (forcedFaction && forcedFaction.availableAugs.length > 0) {
        nextTarget = {
          aug: forcedFaction.availableAugs[0],
          faction: forcedFaction,
          repGap: forcedFaction.availableAugs[0].repReq - forcedFaction.currentRep,
        };
      }
    }

    // === HEADER ===
    ns.print(`${white}AUTO REPUTATION MANAGER${reset}  ${dim}|${reset}  ${green}$${ns.formatNumber(player.money)}${reset}  ${dim}|${reset}  ${yellow}${pendingAugs.length}${reset} ${dim}pending augs${reset}`);

    if (!nextTarget) {
      ns.print(`\n${yellow}No faction with available augmentations found.${reset}`);
      ns.print(`${dim}Join a faction or complete more requirements.${reset}`);
      await ns.sleep(FLAGS.interval);
      continue;
    }

    const target = nextTarget.faction;
    const nextAug = nextTarget.aug;
    const currentWork = ns.singularity.getCurrentWork();

    // Calculate rep gain rate
    const currentRep = target.currentRep;
    const now = Date.now();
    if (lastRep > 0 && lastTargetFaction === target.name) {
      const timeDelta = (now - lastRepTime) / 1000;
      if (timeDelta > 0) {
        const repDelta = currentRep - lastRep;
        repGainRate = repGainRate * 0.7 + (repDelta / timeDelta) * 0.3;
      }
    }
    lastRep = currentRep;
    lastRepTime = now;
    lastTargetFaction = target.name;

    // Auto-work logic (do this early so status reflects current state)
    if (!FLAGS["no-work"] && nextAug && nextAug.repReq > currentRep) {
      const bestWork = selectBestWorkType(ns, player);
      const currentlyWorking = currentWork?.type === 'FACTION' && currentWork?.factionName === target.name;
      if (!currentlyWorking || currentWork.factionWorkType !== bestWork) {
        ns.singularity.workForFaction(target.name, bestWork, false);
      }
    }

    // === CURRENT FOCUS ===
    ns.print('');

    // Faction + work status on one line
    let workStatus = `${dim}not working${reset}`;
    if (currentWork?.type === 'FACTION' && currentWork?.factionName === target.name) {
      workStatus = `${green}${currentWork.factionWorkType}${reset}`;
    } else if (currentWork?.type === 'FACTION') {
      workStatus = `${yellow}working for ${currentWork.factionName}${reset}`;
    } else if (currentWork) {
      workStatus = `${yellow}${currentWork.type.toLowerCase()}${reset}`;
    }
    ns.print(`${cyan}CURRENT FOCUS${reset}: ${white}${target.name}${reset}  ${dim}→${reset}  ${workStatus}  ${dim}(favor: ${target.favor.toFixed(0)}/${ns.getFavorToDonate().toFixed(0)})${reset}`);

    // === NEXT UNLOCK ===
    if (nextAug) {
      const repProgress = Math.min(1, currentRep / nextAug.repReq);
      const repBar = makeBar(repProgress, 40, repProgress >= 1 ? green : cyan);
      const repNeeded = Math.max(0, nextAug.repReq - currentRep);
      const canAfford = player.money - FLAGS.reserve >= nextAug.basePrice;

      ns.print('');
      ns.print(`${cyan}  NEXT UNLOCK${reset}:  ${yellow}${nextAug.name}${reset}`);
      ns.print(`${repBar} ${white}${(repProgress * 100).toFixed(1)}%${reset}`);

      // Rep progress line
      let repLine = `${dim}${ns.formatNumber(currentRep)} / ${ns.formatNumber(nextAug.repReq)} rep${reset}`;
      if (repNeeded > 0) {
        repLine += `  ${dim}(need ${ns.formatNumber(repNeeded)} more)${reset}`;
      }
      ns.print(repLine);

      // ETA and cost on one line
      let etaStr = '';
      if (repNeeded > 0 && repGainRate > 0) {
        etaStr = `${white}ETA:${reset} ${cyan}${formatTime(repNeeded / repGainRate)}${reset} ${dim}@ ${ns.formatNumber(repGainRate)}/s${reset}`;
      } else if (repNeeded <= 0) {
        etaStr = `${green}✓ rep unlocked${reset}`;
      } else {
        etaStr = `${dim}ETA: calculating...${reset}`;
      }
      const costStr = canAfford
        ? `${green}✓ $${ns.formatNumber(nextAug.basePrice)}${reset}`
        : `${red}✗ $${ns.formatNumber(nextAug.basePrice)}${reset} ${dim}(need $${ns.formatNumber(nextAug.basePrice - player.money + FLAGS.reserve)} more)${reset}`;
      ns.print(`${etaStr}  ${dim}|${reset}  ${costStr}`);

      // Ready to purchase banner
      if (repNeeded <= 0 && canAfford) {
        ns.print('');
        ns.print(`${green}▶ READY TO PURCHASE${reset}  ${dim}run${reset} ${white}rep-purchase.js --confirm${reset}`);
      }
    } else {
      ns.print('');
      ns.print(`${green}✓ All augmentations from ${target.name} unlocked!${reset}`);
    }

    // === PURCHASE ORDER ===
    const purchasePlan = calculatePurchasePriority(ns, factionData);

    ns.print('');
    ns.print(`${cyan}${'═'.repeat(65)}${reset}`);

    if (purchasePlan.length === 0) {
      ns.print(`${cyan}PURCHASE ORDER${reset}  ${dim}no augmentations unlocked yet${reset}`);
    } else {
      const totalCost = purchasePlan.reduce((sum, a) => sum + a.adjustedCost, 0);
      const availableMoney = player.money - FLAGS.reserve;
      let runningTotal = 0;
      const affordableCount = purchasePlan.filter(a => {
        runningTotal += a.adjustedCost;
        return runningTotal <= availableMoney;
      }).length;

      ns.print(`${cyan}PURCHASE ORDER${reset}  ${dim}${purchasePlan.length} unlocked, ${green}${affordableCount} affordable${reset}${dim}, $${ns.formatNumber(totalCost)} total${reset}`);
      ns.print('');

      ns.print(`${dim}${'#'.padStart(2)}  ${'Augmentation'.padEnd(34)} ${'Cost'.padStart(11)}  ${'Adjusted'.padStart(11)}    ${'Total'.padStart(11)}${reset}`);

      runningTotal = 0;
      const maxShow = 12;

      for (let i = 0; i < Math.min(purchasePlan.length, maxShow); i++) {
        const item = purchasePlan[i];
        runningTotal += item.adjustedCost;
        const canAffordThis = availableMoney >= runningTotal;
        const color = canAffordThis ? green : dim;
        const nameColor = canAffordThis ? white : dim;

        ns.print(
          `${color}${(i + 1).toString().padStart(2)}${reset}  ` +
          `${nameColor}${item.name.substring(0, 34).padEnd(34)}${reset} ` +
          `${dim}$${ns.formatNumber(item.basePrice).padStart(10)}${reset} → ` +
          `${color}${ns.formatNumber(item.adjustedCost).padStart(10)}${reset}    ` +
          `${color}$${ns.formatNumber(runningTotal).padStart(10)}${reset}`
        );
      }

      if (purchasePlan.length > maxShow) {
        ns.print(`${dim}    ... +${purchasePlan.length - maxShow} more${reset}`);
      }

      if (totalCost > availableMoney) {
        ns.print('');
        ns.print(`${yellow}Need $${ns.formatNumber(totalCost - availableMoney)} more to buy all${reset}`);
      }
    }

    // === SWITCH TO ===
    const otherFactions = factionData.filter(f => f.name !== target.name && f.availableAugs.length > 0);
    const hints = otherFactions.map(f => {
      const nextUnlock = f.availableAugs.find(aug => aug.repReq > f.currentRep);
      if (!nextUnlock) return null;
      return { faction: f.name, aug: nextUnlock.name, repNeeded: nextUnlock.repReq - f.currentRep };
    }).filter(h => h !== null).sort((a, b) => a.repNeeded - b.repNeeded);

    if (hints.length > 0) {
      ns.print('');
      ns.print(`${cyan}SWITCH TO${reset}`);
      for (const hint of hints.slice(0, 4)) {
        ns.print(`  ${white}${hint.faction.padEnd(18)}${reset} ${dim}→${reset} ${yellow}${hint.aug.substring(0, 26).padEnd(26)}${reset} ${dim}(${ns.formatNumber(hint.repNeeded)} rep)${reset}`);
      }
      if (hints.length > 4) {
        ns.print(`  ${dim}+${hints.length - 4} more factions${reset}`);
      }
    }

    await ns.sleep(FLAGS.interval);
  }
}

/**
 * Analyze all joined factions and their augmentations
 */
function analyzeFactions(ns, player, ownedAugs) {
  const factions = player.factions;
  const results = [];

  for (const faction of factions) {
    const allAugs = ns.singularity.getAugmentationsFromFaction(faction);
    const currentRep = ns.singularity.getFactionRep(faction);
    const favor = ns.singularity.getFactionFavor(faction);

    // Filter to unowned augs (excluding NeuroFlux Governor), sorted by rep requirement
    const availableAugs = allAugs
      .filter(aug => !ownedAugs.includes(aug) && aug !== "NeuroFlux Governor")
      .map(aug => ({
        name: aug,
        repReq: ns.singularity.getAugmentationRepReq(aug),
        basePrice: ns.singularity.getAugmentationPrice(aug),
        prereqs: ns.singularity.getAugmentationPrereq(aug),
      }))
      .filter(aug => {
        // Check prereqs are met
        const prereqs = aug.prereqs || [];
        return prereqs.every(p => ownedAugs.includes(p));
      })
      .sort((a, b) => a.repReq - b.repReq);

    results.push({
      name: faction,
      currentRep,
      favor,
      availableAugs,
      nextAugRepGap: availableAugs.length > 0 ? availableAugs[0].repReq - currentRep : Infinity,
    });
  }

  return results;
}

/**
 * Find the next augmentation to target (smallest POSITIVE rep gap across all factions)
 * Only considers augs that aren't unlocked yet (gap > 0)
 */
function findNextAugmentation(factionData) {
  let bestAug = null;
  let bestFaction = null;
  let smallestGap = Infinity;

  for (const faction of factionData) {
    for (const aug of faction.availableAugs) {
      const gap = aug.repReq - faction.currentRep;
      // Only consider augs we don't have rep for yet
      if (gap > 0 && gap < smallestGap) {
        smallestGap = gap;
        bestAug = aug;
        bestFaction = faction;
      }
    }
  }

  if (!bestFaction) return null;

  return {
    aug: bestAug,
    faction: bestFaction,
    repGap: smallestGap,
  };
}

/**
 * Select best work type based on player skills
 */
function selectBestWorkType(ns, player) {
  // Choose based on best stats
  const hacking = player.skills.hacking;
  const combat = (player.skills.strength + player.skills.defense +
                  player.skills.dexterity + player.skills.agility) / 4;
  const charisma = player.skills.charisma;

  // Hacking is usually best for rep gain if you have high hacking
  if (hacking > combat && hacking > charisma) {
    return 'hacking';
  } else if (combat > charisma) {
    return 'field';
  } else {
    return 'field'; // Field work uses mixed stats
  }
}

/**
 * Calculate optimal purchase priority across all factions
 * Only includes augs where we have the required reputation
 */
function calculatePurchasePriority(ns, factionData) {
  // Gather all purchasable augs from all factions (only those with rep)
  const allAugs = [];
  const seen = new Set();

  for (const faction of factionData) {
    for (const aug of faction.availableAugs) {
      if (seen.has(aug.name)) continue;
      seen.add(aug.name);

      // Only include augs we have rep for
      if (faction.currentRep >= aug.repReq) {
        allAugs.push({
          ...aug,
          faction: faction.name,
        });
      }
    }
  }

  // Sort by base price (descending - most expensive first minimizes total cost)
  // Example: $100m + $10m*1.9 = $119m vs $10m + $100m*1.9 = $200m
  allAugs.sort((a, b) => b.basePrice - a.basePrice);

  // Calculate adjusted costs with multiplier
  let multiplier = 1;
  const result = [];

  for (const aug of allAugs) {
    const adjustedCost = Math.round(aug.basePrice * multiplier);
    result.push({
      ...aug,
      adjustedCost,
      multiplier,
    });
    multiplier *= AUG_COST_MULT;
  }

  return result;
}

/**
 * Format seconds to human readable time
 */
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '???';

  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}