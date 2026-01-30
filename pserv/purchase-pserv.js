/** @param {NS} ns */
export async function main(ns) {
  const FLAGS = ns.flags([
    ["ram", 8],
    ["prefix", "pserv"],
    ["limit", 0],
  ]);

  const red = "\u001b[31m";
  const green = "\u001b[32m";
  const reset = "\u001b[0m";

  const ram = Number(FLAGS.ram) || 8;
  const prefix = String(FLAGS.prefix || "pserv");
  const buyLimit = Number(FLAGS.limit) || 0;

  if(ram > 0 && (ram & (ram - 1)) !== 0) {
    ns.tprint(`${red}ERROR: Not a valid RAM size: ${ram}${reset}`)
  }

  const cap = ns.getPurchasedServerLimit();
  let owned = ns.getPurchasedServers().length;
  let bought = 0;

  while (owned < cap && (buyLimit === 0 || bought < buyLimit)) {
    const cost = ns.getPurchasedServerCost(ram);
    const money = ns.getServerMoneyAvailable("home");

    if (money < cost) {
      ns.tprint(`${red}ERROR: need \$${ns.formatNumber(cost)}, have \$${ns.formatNumber(money)}${reset}.`);
    }

    const name = `${prefix}-${ram}-${String(Math.floor(Math.random()*100000)).padStart(5,"0")}`;
    const res = ns.purchaseServer(name, ram);
    if (!res) {
      ns.tprint(`${red}ERROR: failed to buy ${name} (${ram}GB)${reset}`);
      break;
    }

    bought++;
    owned++;
    ns.tprint(`${green}SUCCESS: bought ${name} (${ram}GB)${reset}`);
  }

  ns.tprint(`Done. Bought ${bought} (Own ${owned} / ${cap})`);
}
