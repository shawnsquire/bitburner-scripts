/** @param {NS} ns */
export async function main(ns) {
  const fileToSend = ns.args[0];
  const fileSource = ns.args[1];

  if (!ns.fileExists(fileToSend)) {
    ns.tprint(`ERROR: Failed to send ${fileToSend}; does not exist`);
    return;
  }

  if(fileSource !== undefined && !ns.serverExists(fileSource)) {
    ns.tprint(`ERROR: Failed to send ${fileToSend}; ${fileSource} does not exist`);
    return;
  }

  const pservs = ns.getPurchasedServers();
  for(const host of pservs) {
    ns.scp(fileToSend, host, fileSource);
  }

  ns.tprint(`SUCCESS: Sent to ${pservs.length} servers`);
}
