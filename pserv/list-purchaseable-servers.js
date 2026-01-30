/** @param {NS} ns */
// Prints a table to the terminal, listing the costs of purchasing servers with different amounts of RAM.
// The following info is listed per row:
// - Amount of server RAM
// - Cost of a server with that amount of RAM
// - How many of those servers you could afford with your current money
// - How much it would cost to purchase all those servers
// - How much RAM each server would have relative to your 'home' RAM
export async function main(ns) {
  // Fill array with all size choices for server RAM: 2^1 to 2^x, where x = Math.log2(ns.getPurchasedServerMaxRam())
  const ramSizes = Array.from(Array(Math.log2(ns.getPurchasedServerMaxRam())), (_, i) => Math.pow(2, i + 1));
  const money = ns.getServerMoneyAvailable("home");
  const homeRam = ns.getServerMaxRam("home");
  const serverLimit = ns.getPurchasedServerLimit();
  // Print table header rows.
  ns.tprintf("\n");
  ns.tprintf("RAM size\tServer cost\tCan afford\tTotal cost\t%% of 'home' RAM");
  ns.tprintf("───────────────────────────────────────────────────────────────────────────────");
  // Perform calculations for each RAM size.
  for (let i = 0; i < ramSizes.length; i++) {
    let ramSize = ns.nFormat(ramSizes[i] * 1e9, "0b");
    let serverCost = ns.getPurchasedServerCost(ramSizes[i]);
    let serverLimit = ns.getPurchasedServerLimit();
    let canAfford = Math.floor(money / serverCost);
    let totalCost = ns.nFormat(Math.min(canAfford, serverLimit) * serverCost, "$0a");
    let percentRam = ns.nFormat(ramSizes[i] / homeRam, "0.0%");
    // Format serverCost, totalCost and canAfford after calculations have been completed.
    serverCost = ns.nFormat(serverCost, "$0a")
    if (totalCost === "$0") { totalCost = "-"; }
    if (canAfford > serverLimit) {
      canAfford = serverLimit + "+";
    } else if (canAfford === 0) {
      canAfford = "-";
    }
    // The '%' at the end is required to prevent tprintf() from interpreting the RAM percentage as a placeholder value.
    ns.tprintf(ramSize + "\t\t" + serverCost + "\t\t" + canAfford + "\t\t" + totalCost + "\t\t" + percentRam + "%");
  }
  // Print table footer row.
  ns.tprintf("───────────────────────────────────────────────────────────────────────────────");
}
