/** @param {NS} ns */
export async function main(ns) {
  const FLAGS = ns.flags([
    ['script', ""],
    ['threads', 1],
    ['args', ""],
  ]);

  const script = String(FLAGS.script) || "";
  const threads = Number(FLAGS.threads) || 1;
  const scriptArgs = String(FLAGS.args || "");

  if(script !== undefined && !ns.serverExists(script)) {
    ns.tprint(`ERROR: Failed to run ${script}; does not exist`);
    return;
  }

  const pservs = ns.getPurchasedServers();
  for(const host of pservs) {
    runOnHost(ns, script, scriptArgs, host, threads);
  }
}

/** @param {NS} ns */
function runOnHost(ns, script, scriptArgs, host, threads) {
  const args = parseArgs(scriptArgs);

  if (!ns.fileExists(script, host)) {
    ns.tprint(`ERROR: Failed to send ${script} on ${host}; does not exist`);
    return;
  }

  const running = ns.getRunningScript(script, host, ...args);
  if(running !== null) {
    ns.print(`WARNING: Currently running on ${running.threads} threads; killing...`)
    ns.scriptKill(script, host);
  }

  const costRam = ns.getScriptRam(script, host);
  const serverMax = ns.getServerMaxRam(host);
  const serverUse = ns.getServerUsedRam(host);
  const serverFree = serverMax - serverUse;
  const maxThreads = Math.floor(serverFree / costRam);

  if(threads > 0 && maxThreads < threads) {
    ns.print(`WARNING: Limited to executing on ${maxThreads} instead of requested ${threads}...`)
    threads = maxThreads;
  }

  threads = threads > 0 ? threads : maxThreads;
  ns.exec(script, host, threads, ...args);
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