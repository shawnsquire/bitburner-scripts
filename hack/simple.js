/** @param {NS} ns */
export async function main(ns) {
  const target = ns.args[0];

  // Defines how much money a server should have before we hack it
  const moneyThresh = ns.getServerMaxMoney(target)*0.8; // 80% is fine for now

  // Defines the minimum security level the target server can have.
  const securityThresh = ns.getServerMinSecurityLevel(target)*1.1; // 110% is fine

  // Assume already hacked...

  // Infinite loop that continously hacks/grows/weakens the target server
  while (true) {
    if (ns.getServerSecurityLevel(target) > securityThresh) {
      await ns.weaken(target);
    } else if (ns.getServerMoneyAvailable(target) < moneyThresh) {
      await ns.grow(target);
    } else {
      await ns.hack(target);
    }
  }
}