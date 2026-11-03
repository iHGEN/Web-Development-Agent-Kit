// The outer review sandbox can reach only this broker. It never exposes a
// general-purpose proxy or inherits an upstream proxy from the environment.
import http from "node:http";
import net from "node:net";
import os from "node:os";
import dgram from "node:dgram";
import { Resolver } from "node:dns/promises";

const MODEL_HOSTS = new Set(["api.openai.com", "chatgpt.com", "auth.openai.com"]);
export const REVIEW_PROXY_LIMITS = Object.freeze({
  headerBytes: 8192,
  clients: 8,
  headerMs: 5000,
  connectMs: 5000,
  idleMs: 30000,
  tunnelBytes: 64 * 1024 * 1024,
});
const REPLIES = Object.freeze(Object.fromEntries([
  [400, "Bad Request"], [403, "Forbidden"], [405, "Method Not Allowed"],
  [431, "Request Header Fields Too Large"], [502, "Bad Gateway"], [503, "Service Unavailable"],
].map(([status, message]) => [status, `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`])));

function allowedHostSet(hosts) {
  if (!Array.isArray(hosts) && !(hosts instanceof Set)) {
    throw new Error("Review proxy requires an explicit supported endpoint list.");
  }
  const result = new Set(hosts);
  if (!result.size || result.size > MODEL_HOSTS.size || [...result].some(host => typeof host !== "string" || !MODEL_HOSTS.has(host))) {
    throw new Error("Review proxy endpoint configuration is unsupported.");
  }
  return result;
}

export function parseConnectAuthority(authority, allowedHosts) {
  const allowed = allowedHostSet(allowedHosts);
  // No URL parser normalization: userinfo, escaped hosts, alternate ports,
  // literal IPs, trailing dots and hostname suffixes must not become aliases.
  if (typeof authority !== "string" || authority.length > 253) return null;
  const match = /^([a-z0-9.-]+):443$/.exec(authority);
  return match && match[0] === authority && allowed.has(match[1]) ? { host: match[1], port: 443 } : null;
}

function ipv4Value(address) {
  return address.split(".").reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6Value(address) {
  let value = address.toLowerCase();
  if (value.includes(".")) {
    const split = value.lastIndexOf(":");
    const tail = value.slice(split + 1);
    if (net.isIP(tail) !== 4) return null;
    const number = ipv4Value(tail);
    value = `${value.slice(0, split + 1)}${(number >> 16n).toString(16)}:${(number & 65535n).toString(16)}`;
  }
  const halves = value.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (parts.length !== 8) return null;
  return parts.reduce((number, part) => (number << 16n) | BigInt(`0x${part}`), 0n);
}

function inPrefix(value, base, bits, width) {
  const shift = BigInt(width - bits);
  return (value >> shift) === (base >> shift);
}

const V4_RESERVED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([address, bits]) => [ipv4Value(address), bits]);
const V6_RESERVED = [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["2620:4f:8000::", 48], ["3fff::", 20],
].map(([address, bits]) => [ipv6Value(address), bits]);

function addressKey(address) {
  if (typeof address !== "string") return null;
  const plain = address.split("%")[0];
  const family = net.isIP(plain);
  if (family === 4) return `4:${ipv4Value(plain)}`;
  if (family !== 6) return null;
  const value = ipv6Value(plain);
  if (value === null) return null;
  if ((value >> 32n) === 65535n) return `4:${value & 0xffffffffn}`;
  return `6:${value}`;
}

export function isPublicAddress(address, localAddresses = []) {
  if (typeof address !== "string" || address.includes("%")) return false;
  const family = net.isIP(address);
  if (!family) return false;
  const key = addressKey(address);
  if ([...localAddresses].some(local => addressKey(local) === key)) return false;
  if (family === 4) {
    const value = ipv4Value(address);
    return !V4_RESERVED.some(([base, bits]) => inPrefix(value, base, bits, 32));
  }
  const value = ipv6Value(address);
  // Permit global unicast only, excluding transition/documentation/reserved
  // ranges. This also excludes all IPv4-mapped/compatible and NAT64 aliases.
  return value !== null && inPrefix(value, ipv6Value("2000::"), 3, 128)
    && !V6_RESERVED.some(([base, bits]) => inPrefix(value, base, bits, 128));
}

function localInterfaceAddresses() {
  return Object.values(os.networkInterfaces()).flatMap(entries => (entries || []).map(entry => entry.address));
}

export async function startReviewProxy({ allowedHosts, deadline } = {}) {
  const allowed = allowedHostSet(allowedHosts);
  const remaining = deadline - Date.now();
  if (!Number.isSafeInteger(deadline) || remaining <= 0 || remaining > 3600000) {
    throw new Error("Review proxy requires a current bounded review deadline.");
  }
  const clients = new Set();
  const upstreams = new Set();
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const server = http.createServer({ maxHeaderSize: REVIEW_PROXY_LIMITS.headerBytes });
  // Seatbelt's verified remote-ip selector can also permit UDP. Reserve that
  // protocol/port ourselves so it cannot reach an unrelated host service.
  const datagrams = dgram.createSocket({ type: "udp4", reuseAddr: false });
  datagrams.on("message", () => {});
  server.headersTimeout = REVIEW_PROXY_LIMITS.headerMs;
  server.requestTimeout = REVIEW_PROXY_LIMITS.headerMs;
  server.keepAliveTimeout = 1;
  server.maxConnections = REVIEW_PROXY_LIMITS.clients;
  server.maxRequestsPerSocket = 1;
  let deadlineTimer;
  let closed = false;
  let expired = false;
  let resolving = 0;
  let closing;

  const reject = (socket, status) => {
    if (socket.destroyed) return;
    socket.end(REPLIES[status]);
    const timer = setTimeout(() => socket.destroy(), 250);
    timer.unref();
    socket.once("close", () => clearTimeout(timer));
  };
  const stopTraffic = () => {
    expired = true;
    resolver.cancel();
    for (const socket of clients) socket.destroy();
    for (const socket of upstreams) socket.destroy();
  };
  const close = () => {
    if (closing) return closing;
    closed = true;
    clearTimeout(deadlineTimer);
    stopTraffic();
    closing = Promise.all([
      new Promise(resolve => { try { server.close(() => resolve()); } catch { resolve(); } }),
      new Promise(resolve => { try { datagrams.close(() => resolve()); } catch { resolve(); } }),
    ]).then(() => {});
    return closing;
  };

  server.on("connection", socket => {
    socket.on("error", () => {});
    if (closed || expired || clients.size >= REVIEW_PROXY_LIMITS.clients) { socket.destroy(); return; }
    clients.add(socket);
    socket.setTimeout(REVIEW_PROXY_LIMITS.headerMs, () => socket.destroy());
    socket.once("close", () => clients.delete(socket));
  });
  server.on("request", (_request, response) => {
    response.writeHead(405, { Connection: "close", "Content-Length": "0" });
    response.end();
  });
  server.on("upgrade", (_request, socket) => reject(socket, 405));
  server.on("clientError", (error, socket) => reject(socket, error.code === "HPE_HEADER_OVERFLOW" ? 431 : 400));
  server.on("error", stopTraffic);
  datagrams.on("error", stopTraffic);
  server.on("connect", (request, client, head) => {
    client.pause();
    const target = parseConnectAuthority(request.url, allowed);
    if (closed || Date.now() >= deadline) { reject(client, 503); return; }
    if (!target || request.headers["content-length"] !== undefined || request.headers["transfer-encoding"] !== undefined) {
      reject(client, 403); return;
    }
    if (head.length > 65536) { reject(client, 400); return; }
    // Disconnected clients must not free DNS slots while their lookups remain
    // pending, otherwise rapid connection churn could queue unlimited queries.
    if (resolving >= REVIEW_PROXY_LIMITS.clients) { reject(client, 503); return; }
    resolving += 1;
    // Resolution is cancellable at teardown and bounded independently of the
    // peer's input. Never log headers, credentials, URLs or DNS error details.
    void (async () => {
      let answers;
      try { answers = await Promise.allSettled([resolver.resolve4(target.host), resolver.resolve6(target.host)]); }
      finally { resolving -= 1; }
      if (closed || client.destroyed || Date.now() >= deadline) return;
      const addresses = [...new Set(answers.flatMap(result => result.status === "fulfilled" ? result.value : []))];
      const local = localInterfaceAddresses();
      if (!addresses.length || addresses.length > 64 || addresses.some(address => !isPublicAddress(address, local))) {
        reject(client, 502); return;
      }
      const address = addresses.find(value => net.isIP(value) === 4) || addresses[0];
      // Pass a numeric address, never the hostname: no second DNS lookup and
      // no environment-proxy dispatch can change this validated destination.
      const upstream = net.connect({ host: address, family: net.isIP(address), port: 443 });
      upstreams.add(upstream);
      upstream.setTimeout(REVIEW_PROXY_LIMITS.connectMs, () => upstream.destroy());
      client.once("close", () => upstream.destroy());
      upstream.once("close", () => { upstreams.delete(upstream); client.destroy(); });
      upstream.once("error", () => reject(client, 502));
      upstream.once("connect", () => {
        try {
          if (closed || client.destroyed || Date.now() >= deadline || !isPublicAddress(address, localInterfaceAddresses())) {
            upstream.destroy(); return;
          }
          client.setTimeout(REVIEW_PROXY_LIMITS.idleMs);
          upstream.setTimeout(REVIEW_PROXY_LIMITS.idleMs);
          let bytes = head.length;
          const count = chunk => {
            bytes += chunk.length;
            if (bytes > REVIEW_PROXY_LIMITS.tunnelBytes) { client.destroy(); upstream.destroy(); }
          };
          client.on("data", count);
          upstream.on("data", count);
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          // pipe() supplies backpressure; bodies are never buffered in memory.
          client.pipe(upstream);
          upstream.pipe(client);
          client.resume();
        } catch {
          reject(client, 502);
          upstream.destroy();
        }
      });
    })().catch(() => reject(client, 502));
  });

  try {
    await new Promise((resolve, rejectStart) => {
      server.once("error", rejectStart);
      server.listen({ host: "127.0.0.1", port: 0 }, () => {
        server.removeListener("error", rejectStart);
        resolve();
      });
    });
  } catch {
    await close();
    throw new Error("Review proxy could not reserve its sandbox network endpoint.");
  }
  if (closed || Date.now() >= deadline) { await close(); throw new Error("Review proxy deadline expired during startup."); }
  const port = server.address().port;
  try {
    await new Promise((resolve, rejectStart) => {
      datagrams.once("error", rejectStart);
      datagrams.bind({ address: "127.0.0.1", port, exclusive: true }, () => {
        datagrams.removeListener("error", rejectStart);
        resolve();
      });
    });
  } catch {
    await close();
    throw new Error("Review proxy could not reserve its sandbox network endpoint.");
  }
  if (closed || Date.now() >= deadline) { await close(); throw new Error("Review proxy deadline expired during startup."); }
  // Retain both port reservations on expiry. The owner calls close() after its
  // sandboxed processes have stopped, avoiding a different service taking over
  // the only destination permitted by the outer sandbox.
  deadlineTimer = setTimeout(stopTraffic, deadline - Date.now());
  deadlineTimer.unref();
  return Object.freeze({ port, close });
}
