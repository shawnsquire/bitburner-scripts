import { getAllServers } from '/lib/utils.js';

/** @param {NS} ns */
export async function main(ns) {
  const FLAGS = ns.flags([
    ["prefix", "pserv"],
    ["dry", false],
    ["yes", false],
  ]);

  const prefix = String(FLAGS.prefix || "pserv").trim();
  const dry = !!FLAGS.dry;

  const pservs = ns.getPurchasedServers().sort();
  if (pservs.length === 0) {
    ns.tprint("No purchased servers found.");
    return;
  }

  // Build a set of ALL existing hostnames to avoid collisions with non-pserv servers too
  const existing = new Set(getAllServers(ns));

  // Plan renames
  const plan = pservs.map((oldName) => {
    const ram = Math.round(ns.getServerMaxRam(oldName));
    const newNameBase = `${prefix}-${ram}-${rand5()}`;
    const newName = dedupeName(newNameBase, existing);
    existing.add(newName);
    return { oldName, newName, ram };
  });

  ns.tprint(`Rename plan (${plan.length}):`);
  for (const p of plan) ns.tprint(`  ${p.oldName} -> ${p.newName}`);

  if (dry) return;

  if (!FLAGS.yes) {
    const ok = await ns.prompt('Type "YES" to rename all purchased servers.', { type: "text" });
    if (ok !== "YES") {
      ns.tprint("Cancelled.");
      return;
    }
  }

  // Execute
  for (const p of plan) {
    // If you're connected to a pserv being renamed, Bitburner *should* handle it now,
    // but it's still a good habit to run this from home.
    const success = ns.renamePurchasedServer(p.oldName, p.newName);
    ns.tprint(`${p.oldName} -> ${p.newName} : ${success ? "OK" : "FAIL"}`);
  }
}

/* ---------------- helpers ---------------- */

function rand5() {
  return String(Math.floor(Math.random() * 100000)).padStart(5, "0");
}

function dedupeName(name, existingSet) {
  if (!existingSet.has(name)) return name;
  // if collision, roll a few times
  for (let i = 0; i < 50; i++) {
    const alt = name.replace(/-\d{5}$/, `-${rand5()}`);
    if (!existingSet.has(alt)) return alt;
  }
  // last resort
  return `${name}-${Date.now()}`;
}

