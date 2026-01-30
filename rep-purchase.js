/** @param {NS} ns
 *
 * Augmentation Purchase Script
 *
 * Purchases all unlocked augmentations in optimal order (most expensive first)
 * to minimize total cost due to the 1.9x price multiplier.
 *
 * Requires Singularity API (SF4)
 *
 * Run: run rep-purchase.js              (dry run - shows what would be bought)
 *      run rep-purchase.js --confirm    (actually purchase)
 *      run rep-purchase.js --reserve 1b (keep 1 billion in reserve)
 */
import { COLORS } from '/lib/utils.js';

const AUG_COST_MULT = 1.9;

export async function main(ns) {
  const FLAGS = ns.flags([
    ["confirm", false],   // Actually purchase (default is dry run)
    ["reserve", 0],       // Money to reserve
  ]);

  const { red, green, yellow, cyan, white, dim, reset } = COLORS;

  const player = ns.getPlayer();
  const ownedAugs = ns.singularity.getOwnedAugmentations(true);
  const availableMoney = player.money - FLAGS.reserve;

  // Get all faction data and calculate purchase plan
  const factionData = analyzeFactions(ns, player, ownedAugs);
  const purchasePlan = calculatePurchasePriority(ns, factionData);

  if (purchasePlan.length === 0) {
    ns.tprint(`${yellow}No augmentations unlocked for purchase.${reset}`);
    ns.tprint(`${dim}Earn more reputation to unlock augmentations first.${reset}`);
    return;
  }

  // Calculate what we can afford
  let runningTotal = 0;
  const affordable = [];
  for (const aug of purchasePlan) {
    runningTotal += aug.adjustedCost;
    if (runningTotal <= availableMoney) {
      affordable.push({ ...aug, runningTotal });
    } else {
      break;
    }
  }

  // Display header
  ns.tprint(`${cyan}${'═'.repeat(70)}${reset}`);
  ns.tprint(`${' '.repeat(20)}${white}AUGMENTATION PURCHASE${FLAGS.confirm ? '' : ' (DRY RUN)'}${reset}`);
  ns.tprint(`${cyan}${'═'.repeat(70)}${reset}`);
  ns.tprint(`${dim}Available: $${ns.formatNumber(availableMoney)} | Unlocked: ${purchasePlan.length} augs | Affordable: ${affordable.length} augs${reset}`);
  ns.tprint('');

  if (affordable.length === 0) {
    ns.tprint(`${yellow}Cannot afford any augmentations.${reset}`);
    ns.tprint(`${dim}Cheapest unlocked aug costs $${ns.formatNumber(purchasePlan[0]?.adjustedCost || 0)}${reset}`);
    return;
  }

  // Display purchase plan
  ns.tprint(`${dim}${'#'.padStart(2)} ${'Augmentation'.padEnd(35)} ${'Faction'.padEnd(18)} ${'Cost'.padStart(12)}${reset}`);
  ns.tprint(`${dim}${'─'.repeat(70)}${reset}`);

  for (let i = 0; i < affordable.length; i++) {
    const aug = affordable[i];
    ns.tprint(
      `${green}${(i + 1).toString().padStart(2)}${reset} ` +
      `${white}${aug.name.substring(0, 35).padEnd(35)}${reset} ` +
      `${cyan}${aug.faction.substring(0, 18).padEnd(18)}${reset} ` +
      `${green}$${ns.formatNumber(aug.adjustedCost).padStart(11)}${reset}`
    );
  }

  ns.tprint(`${dim}${'─'.repeat(70)}${reset}`);
  ns.tprint(`${white}Total: ${green}$${ns.formatNumber(affordable[affordable.length - 1].runningTotal)}${reset} for ${green}${affordable.length}${reset} augmentations`);

  if (affordable.length < purchasePlan.length) {
    const remaining = purchasePlan.length - affordable.length;
    ns.tprint(`${yellow}${remaining} more aug${remaining > 1 ? 's' : ''} unlocked but not affordable${reset}`);
  }

  ns.tprint('');

  // Execute purchases if confirmed
  if (!FLAGS.confirm) {
    ns.tprint(`${yellow}DRY RUN - No purchases made.${reset}`);
    ns.tprint(`${dim}Run with --confirm to actually purchase these augmentations.${reset}`);
    return;
  }

  ns.tprint(`${cyan}Purchasing augmentations...${reset}`);
  ns.tprint('');

  let purchased = 0;
  let spent = 0;

  for (const aug of affordable) {
    const success = ns.singularity.purchaseAugmentation(aug.faction, aug.name);
    if (success) {
      ns.tprint(`${green}✓${reset} Purchased ${white}${aug.name}${reset} from ${cyan}${aug.faction}${reset}`);
      purchased++;
      spent += aug.adjustedCost;
    } else {
      ns.tprint(`${red}✗${reset} Failed to purchase ${aug.name} - may need prereqs or price changed`);
    }
    await ns.sleep(50); // Small delay between purchases
  }

  ns.tprint('');
  ns.tprint(`${cyan}${'═'.repeat(70)}${reset}`);
  ns.tprint(`${white}Purchased ${green}${purchased}${reset}/${affordable.length} augmentations for ~$${ns.formatNumber(spent)}${reset}`);

  if (purchased > 0) {
    ns.tprint('');
    ns.tprint(`${yellow}Remember to install augmentations when ready:${reset}`);
    ns.tprint(`${dim}ns.singularity.installAugmentations() or use the Augmentations menu${reset}`);
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
    });
  }

  return results;
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
