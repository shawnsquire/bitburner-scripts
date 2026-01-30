/** @param {NS} ns */
export async function main(ns) {
  const BACKDOOR = [
    "CSEC",
    "avmnite-02h",
    "I.I.I.I",
    "run4theh111z",
  ];

  for (const host of BACKDOOR) {
    ns.run("/path-to.js", 1, host);
  }
}