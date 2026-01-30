/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog('ALL');
  ns.ui.openTail();

  const SLEEP_DELAY = 10000;

  const BACKDOOR = [
    "CSEC",
    "avmnite-02h",
    "I.I.I.I",
    "run4theh111z",
  ];

  while (true) {
    const player = ns.getPlayer();
    const hackTools = {
      "ssh":  ns.fileExists("BruteSSH.exe", "home"),
      "ftp":  ns.fileExists("FTPCrack.exe", "home"),
      "sql": ns.fileExists("SQLInject.exe", "home"),
      "http": ns.fileExists("HTTPWorm.exe", "home"),
      "smtp": ns.fileExists("relaySMTP.exe", "home"),
    }
    const numHackTools = hackTools["ssh"] + hackTools["ftp"] + hackTools["sql"] + hackTools["http"] + hackTools["smtp"];

    const foundServers = new Set([`home`]);
    
    for (const server of foundServers) ns.scan(server).forEach(adjacentServer => foundServers.add(adjacentServer));
    const hackableServers = [...foundServers].sort().map(h => ns.getServer(h))
      .filter(s => !s.hasAdminRights)
      .filter(s => s.requiredHackingSkill <= player.skills.hacking)
      .filter(s => s.numOpenPortsRequired <= numHackTools);
  
    if (hackableServers.length > 0) {
      ns.print(`${hackableServers.length} servers found available to hack!`)
    
  
      for (const server of hackableServers) {
        ns.print(`Hacking ${server.hostname}...`)
        ns.run("hack/exploit.js", 1, server.hostname)
        ns.print(`Done.`)

        if (BACKDOOR.includes(server.hostname) && !server.backdoorInstalled) {
          ns.print("BACKDOOR REQUESTED") // Note: Replace this eventually with actual backdoor install
        }
      }
    }

    await ns.sleep(SLEEP_DELAY);
  }
}
