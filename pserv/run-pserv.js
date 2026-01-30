/** @param {NS} ns */
export async function main(ns) {
  const FLAGS = ns.flags([
    ["script", ""],      // required: path to script on home, e.g. "hack/weaken.js"
    ["threads", 0],      // 0 = auto (max possible per server)
    ["args", ""],        // optional: comma-separated args, e.g. "n00dles,5,true"
    ["dry", false],      // only print what would happen
    ["kill", false],     // kill target script before starting it
    ["all", false],      // run even if script is already running
  ]);

  const script = String(FLAGS.script || "").trim();
  if (!script) {
    ns.tprint('Usage: run pserv-run.js --script "path/to/script.js" [--threads N] [--args "a,b,c"] [--kill] [--dry] [--all]');
    return;
  }

  if (!ns.fileExists(script, "home")) {
    ns.tprint(`Missing on home: ${script}`);
    return;
  }

  const args = parseArgs(String(FLAGS.args || ""));
  const forcedThreads = Number(FLAGS.threads) || 0;

  const pservs = ns.getPurchasedServers().sort((a, b) => a.localeCompare(b));
  ns.tprint(`Purchased servers (${pservs.length}): ${pservs.join(", ") || "(none)"}`);

  for (const host of pservs) {
    await ensureScriptOnServer(ns, host, script);

    if (FLAGS.kill) ns.scriptKill(script, host);

    const already = ns.isRunning(script, host, ...args);
    if (already && !FLAGS.all) {
      ns.tprint(`${host}: already running ${script} ${fmtArgs(args)} (skip)`);
      continue;
    }

    const maxThreads = maxThreadsFor(ns, host, script);
    const threads = forcedThreads > 0 ? Math.min(forcedThreads, maxThreads) : maxThreads;

    if (threads <= 0) {
      ns.tprint(`${host}: not enough RAM for ${script} (need ${ns.getScriptRam(script, "home")}GB)`);
      continue;
    }

    const cmd = `${script} ${fmtArgs(args)} (t=${threads})`;
    if (FLAGS.dry) {
      ns.tprint(`${host}: would run ${cmd}`);
      continue;
    }

    const pid = ns.exec(script, host, threads, ...args);
    ns.tprint(`${host}: ${pid ? "started" : "FAILED"} ${cmd}`);
  }
}

/* ---------------- helpers ---------------- */

async function ensureScriptOnServer(ns, host, script) {
  // copy only if missing (keeps log quieter)
  if (!ns.fileExists(script, host)) {
    await ns.scp(script, host, "home");
  }
}

function maxThreadsFor(ns, host, script) {
  const ramPerThread = ns.getScriptRam(script, "home");
  const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
  return Math.floor(free / ramPerThread);
}

function parseArgs(s) {
  const raw = String(s || "").trim();
  if (!raw) return [];
  return raw.split(",").map((v) => coerce(v.trim()));
}

function coerce(v) {
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function fmtArgs(args) {
  return args.length ? args.map(String).join(" ") : "";
}