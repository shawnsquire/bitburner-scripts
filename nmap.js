import { discoverAllWithDepthAndPath, pathTo } from '/lib/utils.js';

/** @param {NS} ns */
export async function main(ns) {
  const FLAGS = ns.flags([
    ["start", "home"],
    ["depth", -1],
    ["sort", "depth,host"], // comma-separated fields; prefix with "-" for desc
    ["limit", 0], // 0 = no limit
    ["where", ""], // filters
  ]);

  const start = String(FLAGS.start);
  const sortSpec = String(FLAGS.sort ?? "").trim();
  const maxDepth = Number(FLAGS.depth ?? -1);
  const limit = Number(FLAGS.limit) || 0;
  const predicate = buildPredicate(String(FLAGS.where || "").trim());


  const { hosts, depthByHost, parentByHost } = discoverAllWithDepthAndPath(ns, start, maxDepth);

  const rows = hosts.map((h) => toRow(ns, h, depthByHost.get(h) ?? -1, pathToDisplay(parentByHost, h)));
  const comparators = buildComparators(sortSpec);

  const filtered = rows.filter(predicate);
  const sorted = [...filtered].sort(multiSort(comparators));

  ns.tprint(`Network map from ${start} (${sorted.length} servers) | sort=${sortSpec || "depth,host"}`);

  const header = [
    pad("HOST", 20),
    pad("D", 2),     // Depth
    pad("P", 1),     // Player-purchased
    pad("BD", 2),    // Backdoor
    pad("ROOT", 4),  // Root Acquired
    pad("REQ", 5),   // Hacking Required
    pad("PORT", 4),  // Ports Required
    pad("RAM(U/F/M)", 17),
    pad("$ (A/M)", 22),
    pad("SEC(C/M)", 13),
    pad("GROW", 6),
  ].join("  ");

  ns.tprint(header);
  ns.tprint("-".repeat(header.length));

  const out = limit > 0 ? sorted.slice(0, limit) : sorted;
  for (const r of out) {
    if(r.ramMax > 0) ns.tprint(renderRow(r));
  }

  ns.tprint(
    `Sort fields: host,depth,reqHack,ports,ramUsed,ramFree,ramMax,moneyAvail,moneyMax,moneyPct,secCur,secMin,secDelta,growth,purchased,backdoor,root`,
  );
}

/* ------------------------------ discovery ------------------------------ */

// Local pathTo that excludes both start and target for display purposes
function pathToDisplay(parentByHost, target) {
  const path = [];
  let cur = target;

  while (cur !== null && cur !== undefined) {
    path.push(cur);
    cur = parentByHost.get(cur);
  }

  return path.slice(1).reverse().slice(1).join(" > ");
}

/* ------------------------------- row build ------------------------------ */

function toRow(ns, host, depth, path) {
  const s = ns.getServer(host);

  const ramMax = ns.getServerMaxRam(host);
  const ramUsed = ns.getServerUsedRam(host);
  const ramFree = Math.max(0, ramMax - ramUsed);

  const moneyMax = ns.getServerMaxMoney(host);
  const moneyAvail = ns.getServerMoneyAvailable(host);
  const moneyPct = moneyMax > 0 ? moneyAvail / moneyMax : 0;

  const secMin = ns.getServerMinSecurityLevel(host);
  const secCur = ns.getServerSecurityLevel(host);
  const secDelta = secCur - secMin;

  const reqHack = ns.getServerRequiredHackingLevel(host);
  const ports = ns.getServerNumPortsRequired(host);
  const growth = ns.getServerGrowth(host);

  return {
    // display fields
    host,
    depth,

    purchased: !!s.purchasedByPlayer,
    backdoor: !!s.backdoorInstalled,
    root: !!s.hasAdminRights,

    reqHack,
    ports,
    growth,

    // derived numeric sort keys
    ramMax,
    ramUsed,
    ramFree,

    moneyMax,
    moneyAvail,
    moneyPct,

    secMin,
    secCur,
    secDelta,

    path,
  };
}

function renderRow(r) {
  const ramStr = `${fmtRam(r.ramUsed)}/${fmtRam(r.ramFree)}/${fmtRam(r.ramMax)}`;
  const moneyStr =
    r.moneyMax > 0 ? `${fmtNum(r.moneyAvail)}/${fmtNum(r.moneyMax)}` : "-";
  const secStr = `${r.secCur.toFixed(1)}/${r.secMin.toFixed(1)}`;

  return [
    pad(r.host, 20),
    pad(String(r.depth), 2),

    pad(r.purchased ? "$" : " ", 1),
    pad(r.backdoor ? "B" : " ", 2),
    pad(r.root ? "R" : " ", 4),

    pad(String(r.reqHack), 5),
    pad(String(r.ports), 4),

    pad(ramStr, 17),
    pad(moneyStr, 22),
    pad(secStr, 13),
    pad(String(Math.round(r.growth || 0)), 6),
  ].join("  ");
}

/* ------------------------------- sorting ------------------------------- */

/**
 * --sort "ramFree,-moneyMax,reqHack,host"
 * prefix "!" for descending
 */
function buildComparators(sortSpec) {
  const spec = (sortSpec || "depth,host")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return spec.map((tokenRaw) => {
    const desc = tokenRaw.startsWith("!");
    const token = desc ? tokenRaw.slice(1) : tokenRaw;

    // map token -> accessor
    const get = fieldAccessor(token);

    // comparator: numbers then strings
    return (a, b) => {
      const av = get(a);
      const bv = get(b);

      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av === bv ? 0 : av < bv ? -1 : 1;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return desc ? -cmp : cmp;
    };
  });
}

function fieldAccessor(field) {
  // Everything here can be referenced in --sort.
  // If unknown, fall back to host so it doesn't explode.
  switch (field) {
    case "host":
      return (r) => r.host;
    case "depth":
      return (r) => r.depth;

    case "reqHack":
      return (r) => r.reqHack;
    case "ports":
      return (r) => r.ports;

    case "ramUsed":
      return (r) => r.ramUsed;
    case "ramFree":
      return (r) => r.ramFree;
    case "ramMax":
      return (r) => r.ramMax;

    case "moneyAvail":
      return (r) => r.moneyAvail;
    case "moneyMax":
      return (r) => r.moneyMax;
    case "moneyPct":
      return (r) => r.moneyPct;

    case "secCur":
      return (r) => r.secCur;
    case "secMin":
      return (r) => r.secMin;
    case "secDelta":
      return (r) => r.secDelta;

    case "growth":
      return (r) => r.growth;

    // boolean-ish sortable (false < true)
    case "purchased":
      return (r) => (r.purchased ? 1 : 0);
    case "backdoor":
      return (r) => (r.backdoor ? 1 : 0);
    case "root":
      return (r) => (r.root ? 1 : 0);

    default:
      return (r) => r.host;
  }
}

function multiSort(comparators) {
  const comps = comparators?.length ? comparators : [(a, b) => a.host.localeCompare(b.host)];
  return (a, b) => {
    for (const cmp of comps) {
      const v = cmp(a, b);
      if (v !== 0) return v;
    }
    return 0;
  };
}

/* ------------------------------ formatting ----------------------------- */

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s.padEnd(n, " ");
}

// Keep formatting independent of ns to make the helpers reusable.
function fmtRam(gb) {
  // Bitburner RAM is in GB already (number), so just keep it readable.
  if (!isFinite(gb)) return "-";
  if (gb >= 1024) return `${(gb / 1024).toFixed(0)}TB`;
  if (gb >= 1) return `${gb.toFixed(gb < 10 ? 0 : 0)}GB`;
  if (gb > 0) return `${(gb * 1024).toFixed(0)}MB`;
  return "0GB";
}

function fmtNum(n) {
  if (!isFinite(n)) return "-";
  // compact-ish without relying on ns.formatNumber
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e15) return `${sign}${(abs / 1e15).toFixed(2)}q`;
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}t`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}k`;
  return `${sign}${abs.toFixed(0)}`;
}


/* ------------------------------ predicates ----------------------------- */

function buildPredicate(whereSpec) {
  if (!whereSpec) return () => true;

  const terms = whereSpec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseTerm);

  return (row) => terms.every((t) => t(row));
}

function parseTerm(raw) {
  // NOT support: !rooted, !purchased, etc
  const negate = raw.startsWith("!");
  const term = negate ? raw.slice(1).trim() : raw;

  // Comparators in priority order
  const ops = [">=", "<=", "!=", "=", ">", "<"];
  const op = ops.find((o) => term.includes(o));

  // Bare boolean like "rooted"
  if (!op) {
    const get = fieldAccessorForFilter(term);
    const pred = (row) => !!get(row);
    return negate ? (row) => !pred(row) : pred;
  }

  const [left, rightRaw] = term.split(op).map((s) => s.trim());
  const get = fieldAccessorForFilter(left);

  const right =
    rightRaw === "true" ? true :
    rightRaw === "false" ? false :
    Number.isFinite(Number(rightRaw)) ? Number(rightRaw) :
    rightRaw;

  const pred = (row) => compare(get(row), op, right);
  return negate ? (row) => !pred(row) : pred;
}

function compare(a, op, b) {
  // If either side looks numeric, compare numerically
  const an = Number(a), bn = Number(b);
  const numeric = Number.isFinite(an) && Number.isFinite(bn);
  const av = numeric ? an : a;
  const bv = numeric ? bn : b;

  switch (op) {
    case ">=": return av >= bv;
    case "<=": return av <= bv;
    case ">":  return av > bv;
    case "<":  return av < bv;
    case "=":  return av === bv;
    case "!=": return av !== bv;
    default:   return false;
  }
}

function fieldAccessorForFilter(field) {
  // aliases that feel nice to type
  switch (field) {
    case "rooted": return (r) => r.root;
    case "bd": return (r) => r.backdoor;
    case "p": return (r) => r.purchased;
    default: return fieldAccessor(field); // reuse your sort accessor
  }
}
