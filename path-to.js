/** @param {NS} ns */
export async function main(ns) {
  const red = "\u001b[31m";
  const reset = "\u001b[0m";

  const host = ns.args[0];
  const source = ns.args[1];

  if (host === undefined || !ns.serverExists(host)) {
    ns.tprint(`${red}ERROR: Server ${host} does not exist.${reset}`);
    return;
  }

  const start = (source === undefined || !ns.serverExists(source)) ? "home" : source;

  const { hosts, depthByHost, parentByHost } = discoverAllWithDepthAndPath(ns, start, 100);
  const path = pathTo(parentByHost, host);

  ns.tprint(path);
}

function discoverAllWithDepthAndPath(ns, start, maxDepth) {
  // Shortest known depth to each host
  const depthByHost = new Map([[start, 0]]);
  // Parent pointer to reconstruct path
  const parentByHost = new Map([[start, null]]);
  // Queue holds nodes whose neighbors need relaxing
  const q = [start];

  while (q.length) {
    const cur = q.shift();
    const curDepth = depthByHost.get(cur);

    for (const n of ns.scan(cur)) {
      const candDepth = curDepth + 1;
      const prevDepth = depthByHost.get(n);

      // If unseen OR we found a shorter path, update ("relax") it
      if (prevDepth === undefined || candDepth < prevDepth) {
        depthByHost.set(n, candDepth);
        parentByHost.set(n, cur);

        if (maxDepth < 0 || curDepth+1 < maxDepth)
          q.push(n);
      }
    }
  }

  // Stable-ish ordering: depth then host
  const hosts = [...depthByHost.keys()].sort((a, b) => {
    const da = depthByHost.get(a);
    const db = depthByHost.get(b);
    return da - db || a.localeCompare(b);
  });

  return { hosts, depthByHost, parentByHost };
}

function pathTo(parentByHost, target) {
  const path = [];
  let cur = target;

  while (cur !== null && cur !== undefined) {
    path.push(cur);
    cur = parentByHost.get(cur);
  }

  return path.reverse().join(" > ");
}