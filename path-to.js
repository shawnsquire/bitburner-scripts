import { COLORS, discoverAllWithDepthAndPath, pathTo } from '/lib/utils.js';

/** @param {NS} ns */
export async function main(ns) {
  const { red, reset } = COLORS;

  const host = ns.args[0];
  const source = ns.args[1];

  if (host === undefined || !ns.serverExists(host)) {
    ns.tprint(`${red}ERROR: Server ${host} does not exist.${reset}`);
    return;
  }

  const start = (source === undefined || !ns.serverExists(source)) ? "home" : source;

  const { parentByHost } = discoverAllWithDepthAndPath(ns, start, 100);
  const path = pathTo(parentByHost, host, true);

  ns.tprint(path);
}
