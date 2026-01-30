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

  const servers = ns.getPurchasedServers().map(x => ns.getServer(x)).filter(x => x.maxRam < ram);
  ns.tprint(`Attempting to upgrade ${servers.length} servers...`)
  let bought = 0;
  for(const server of servers) {
    const host = server.hostname;
    const cost = ns.getPurchasedServerUpgradeCost(host, ram);
    const money = ns.getServerMoneyAvailable("home");

    if (money < cost) {
      ns.tprint(`${red}ERROR: need \$${ns.formatNumber(cost)}, have \$${ns.formatNumber(money)}${reset}.`);
    }

    const res = ns.upgradePurchasedServer(host, ram);
    if (!res) {
      ns.tprint(`${red}ERROR: failed to upgrade ${host} (${ram}GB)${reset}`);
      break;
    }

    const newname = `${prefix}-${ram}-${String(Math.floor(Math.random()*100000)).padStart(5,"0")}`;
    ns.renamePurchasedServer(host, newname);

    bought++;
    ns.tprint(`${green}SUCCESS: upgraded ${host} to ${ram}GB${reset} and renamed to ${newname}`);
  }

  ns.tprint(`Done. Upgraded ${bought}`);
}
