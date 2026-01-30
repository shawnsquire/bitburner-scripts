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
    ns.print(`${cyan}${'═'.repeat(60)}${reset}`);
    ns.print(`${' '.repeat(20)}${white}AUTO REPUTATION MANAGER${reset}`);
    ns.print(`${cyan}${'═'.repeat(60)}${reset}`);
    ns.print(`${dim}Money: ${green}$${ns.formatNumber(player.money)}${reset} ${dim}| Pending Augs: ${yellow}${pendingAugs.length}${reset}`);

    if (!nextTarget) {
      ns.print(`\n${yellow}No faction with available augmentations found.${reset}`);
      ns.print(`${dim}Join a faction or complete more requirements.${reset}`);
      await ns.sleep(FLAGS.interval);
      continue;
    }

    const target = nextTarget.faction;
    const nextAug = nextTarget.aug;

    // Calculate rep gain rate
    const currentRep = target.currentRep;
    const now = Date.now();
    if (lastRep > 0 && lastTargetFaction === target.name) {
      const timeDelta = (now - lastRepTime) / 1000; // seconds
      if (timeDelta > 0) {
        const repDelta = currentRep - lastRep;
        repGainRate = repGainRate * 0.7 + (repDelta / timeDelta) * 0.3; // smoothed
      }
    }
    lastRep = currentRep;
    lastRepTime = now;
    lastTargetFaction = target.name;

    // === FACTION STATUS ===
    ns.print(`\n${white}Target Faction: ${cyan}${target.name}${reset}`);
    ns.print(`${dim}Favor: ${target.favor.toFixed(0)} | Favor to donate: ${ns.getFavorToDonate().toFixed(0)}${reset}`);

    if (nextAug) {
      const repProgress = Math.min(1, currentRep / nextAug.repReq);
      const repBar = makeBar(repProgress, 30, repProgress >= 1 ? green : cyan);
      const repNeeded = Math.max(0, nextAug.repReq - currentRep);

      ns.print(`\n${white}Next Augmentation: ${yellow}${nextAug.name}${reset}`);
      ns.print(`${dim}Rep Required: ${ns.formatNumber(nextAug.repReq)} | Cost: $${ns.formatNumber(nextAug.basePrice)}${reset}`);
      ns.print(`${white}Progress: ${repBar} ${(repProgress * 100).toFixed(1)}%${reset}`);
      ns.print(`${dim}Current: ${ns.formatNumber(currentRep)} / ${ns.formatNumber(nextAug.repReq)} (need ${ns.formatNumber(repNeeded)} more)${reset}`);

      // ETA calculation
      if (repNeeded > 0 && repGainRate > 0) {
        const etaSeconds = repNeeded / repGainRate;
        const etaStr = formatTime(etaSeconds);
        ns.print(`${white}ETA: ${cyan}${etaStr}${reset} ${dim}(${ns.formatNumber(repGainRate)}/s)${reset}`);
      } else if (repNeeded <= 0) {
        ns.print(`${green}✓ Reputation requirement met!${reset}`);
      } else {
        ns.print(`${dim}ETA: calculating...${reset}`);
      }

      // Money status
      const canAfford = player.money - FLAGS.reserve >= nextAug.basePrice;
      const moneyStatus = canAfford
        ? `${green}✓ Can afford${reset}`
        : `${red}✗ Need $${ns.formatNumber(nextAug.basePrice - player.money + FLAGS.reserve)} more${reset}`;
      ns.print(`${white}Money: ${moneyStatus}`);

      // Ready to purchase?
      if (repNeeded <= 0 && canAfford) {
        ns.print(`\n${green}▶ READY TO PURCHASE: ${nextAug.name}${reset}`);
        ns.print(`${dim}Use: ns.singularity.purchaseAugmentation("${target.name}", "${nextAug.name}")${reset}`);
      }
    } else {
      ns.print(`\n${green}All available augmentations from this faction are owned!${reset}`);
    }

    // === WORK STATUS ===
    const currentWork = ns.singularity.getCurrentWork();
    ns.print(`\n${dim}${'─'.repeat(60)}${reset}`);

    if (currentWork && currentWork.type === 'FACTION') {
      ns.print(`${white}Working: ${green}${currentWork.factionWorkType}${reset} for ${cyan}${currentWork.factionName}${reset}`);
    } else if (currentWork) {
      ns.print(`${white}Current Work: ${yellow}${currentWork.type}${reset}`);
    } else {
      ns.print(`${dim}Not currently working${reset}`);
    }

    // Auto-work logic
    if (!FLAGS["no-work"] && nextAug && nextAug.repReq > currentRep) {
      const bestWork = selectBestWorkType(ns, player);
      const currentlyWorking = currentWork?.type === 'FACTION' && currentWork?.factionName === target.name;

      if (!currentlyWorking || currentWork.factionWorkType !== bestWork) {
        const success = ns.singularity.workForFaction(target.name, bestWork, false);
        if (success) {
          ns.print(`${cyan}→ Started ${bestWork} work for ${target.name}${reset}`);
        }
      }
    }

    // === AUGMENTATION PURCHASE PRIORITY ===
    ns.print(`\n${cyan}${'═'.repeat(60)}${reset}`);
    ns.print(`${white}RECOMMENDED PURCHASE ORDER${reset}`);
    ns.print(`${dim}(Most expensive first - minimizes total cost with 1.9x multiplier)${reset}`);
    ns.print(`${cyan}${'═'.repeat(60)}${reset}`);

    const purchasePlan = calculatePurchasePriority(ns, factionData);

    if (purchasePlan.length === 0) {
      ns.print(`${dim}No augmentations unlocked for purchase yet.${reset}`);
    } else {
      // Header (simplified - all items have rep)
      ns.print(`${dim}${'#'.padStart(2)} ${'Augmentation'.padEnd(32)} ${'Adj Cost'.padStart(12)} ${'Running Total'.padStart(14)}${reset}`);
      ns.print(`${dim}${'─'.repeat(65)}${reset}`);

      let runningTotal = 0;
      const maxShow = 15;

      for (let i = 0; i < Math.min(purchasePlan.length, maxShow); i++) {
        const item = purchasePlan[i];
        runningTotal += item.adjustedCost;

        const canAffordThis = player.money - FLAGS.reserve >= runningTotal;
        const numColor = canAffordThis ? green : dim;
        const nameColor = canAffordThis ? white : dim;
        const costColor = canAffordThis ? green : dim;

        ns.print(
          `${numColor}${(i + 1).toString().padStart(2)}${reset} ` +
          `${nameColor}${item.name.substring(0, 32).padEnd(32)}${reset} ` +
          `${costColor}$${ns.formatNumber(item.adjustedCost).padStart(11)}${reset} ` +
          `${costColor}$${ns.formatNumber(runningTotal).padStart(13)}${reset}`
        );
      }

      if (purchasePlan.length > maxShow) {
        ns.print(`${dim}... +${purchasePlan.length - maxShow} more augmentations${reset}`);
      }

      // Summary
      const totalCost = purchasePlan.reduce((sum, a) => sum + a.adjustedCost, 0);
      const affordableCount = purchasePlan.filter((a, i) => {
        const running = purchasePlan.slice(0, i + 1).reduce((s, x) => s + x.adjustedCost, 0);
        return player.money - FLAGS.reserve >= running;
      }).length;

      ns.print(`${dim}${'─'.repeat(65)}${reset}`);
      ns.print(`${white}Total: ${reset}${ns.formatNumber(purchasePlan.length)} augs | $${ns.formatNumber(totalCost)} | ${green}${affordableCount} affordable${reset}`);

      // Warning if total exceeds available money
      const availableMoney = player.money - FLAGS.reserve;
      if (totalCost > availableMoney) {
        ns.print(`${yellow}⚠ Need $${ns.formatNumber(totalCost - availableMoney)} more to buy all${reset}`);
      }
    }

    // === SWITCH HINTS (Other Factions) ===
    const otherFactions = factionData.filter(f => f.name !== target.name && f.availableAugs.length > 0);
    if (otherFactions.length > 0) {
      ns.print(`\n${dim}${'─'.repeat(60)}${reset}`);
      ns.print(`${white}SWITCH HINTS${reset} ${dim}(other factions' next unlockable aug)${reset}`);

      // Find the next unlockable aug for each faction (smallest positive gap)
      const hints = otherFactions.map(f => {
        const nextUnlock = f.availableAugs.find(aug => aug.repReq > f.currentRep);
        if (!nextUnlock) return null;
        return {
          faction: f.name,
          aug: nextUnlock.name,
          repNeeded: nextUnlock.repReq - f.currentRep,
          repReq: nextUnlock.repReq,
        };
      }).filter(h => h !== null).sort((a, b) => a.repNeeded - b.repNeeded);

      for (const hint of hints.slice(0, 5)) {
        ns.print(`${dim}  ${cyan}${hint.faction.padEnd(20)}${reset} ${dim}→${reset} ${yellow}${hint.aug.substring(0, 25).padEnd(25)}${reset} ${dim}(need ${ns.formatNumber(hint.repNeeded)} rep)${reset}`);
      }
      if (hints.length > 5) {
        ns.print(`${dim}  ... +${hints.length - 5} more factions${reset}`);
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