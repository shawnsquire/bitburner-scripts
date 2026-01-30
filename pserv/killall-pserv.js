/** @param {NS} ns */
export async function main(ns) {
  const pservs = ns.getPurchasedServers();
  for(const host of pservs) {
    ns.killall(host);
  }

  ns.tprint(`SUCCESS: Killed scripts on ${pservs.length} servers`); 
}