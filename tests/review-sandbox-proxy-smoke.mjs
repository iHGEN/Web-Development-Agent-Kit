#!/usr/bin/env node
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import dgram from "node:dgram";
import http from "node:http";
import { once } from "node:events";
import { Resolver } from "node:dns/promises";
import { Duplex } from "node:stream";
import { isPublicAddress, parseConnectAuthority, REVIEW_PROXY_LIMITS, startReviewProxy } from "../pack/runtime/review-sandbox-proxy.mjs";

const hosts = ["api.openai.com", "chatgpt.com", "auth.openai.com"];
for (const host of hosts) assert.deepEqual(parseConnectAuthority(`${host}:443`, hosts), { host, port: 443 });
for (const authority of [
  "api.openai.com", "api.openai.com:80", "api.openai.com:0443", "API.OPENAI.COM:443",
  "api.openai.com.:443", "api.openai.com.attacker.test:443", "attackerapi.openai.com:443",
  "https://api.openai.com:443", "user:password@api.openai.com:443", "127.0.0.1:443",
  "[::1]:443", "api%2eopenai.com:443", "api.openai.com:443/path", " api.openai.com:443",
  "api.openai.com:443\r\n", "api.openai.com:443\n", "api.openai.com\0:443", "api.openai.com:443?query", null,
]) assert.equal(parseConnectAuthority(authority, hosts), null, `Unsafe CONNECT authority accepted: ${JSON.stringify(authority)}`);
assert.equal(parseConnectAuthority("chatgpt.com:443", ["api.openai.com"]), null);
for (const invalid of [[], ["attacker.test"], ["API.OPENAI.COM"], "api.openai.com", null, ["api.openai.com", 1]]) {
  assert.throws(() => parseConnectAuthority("api.openai.com:443", invalid), /endpoint/);
}

for (const address of ["1.1.1.1", "8.8.8.8", "100.63.255.254", "100.128.0.1", "172.15.1.1", "172.32.0.1", "192.0.1.1", "2001:4860:4860::8888", "2606:4700:4700::1111"]) {
  assert.equal(isPublicAddress(address), true, `Public address rejected: ${address}`);
}
for (const address of [
  "0.0.0.0", "0.8.8.8", "10.255.0.1", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.255.255.254",
  "169.254.169.254", "172.16.0.1", "172.31.255.254", "192.0.0.9", "192.0.2.1", "192.31.196.1",
  "192.52.193.1", "192.88.99.1", "192.168.1.1", "192.175.48.1", "198.18.0.1", "198.19.255.254",
  "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "::ffff:808:808", "::8.8.8.8",
  "64:ff9b::808:808", "64:ff9b:1::808:808", "100::1", "2001::1", "2001:1ff::1", "2001:db8::1",
  "2002:808:808::1", "2620:4f:8000::1", "3fff::1", "3fff:fff::1", "fc00::1", "fe80::1", "ff02::1",
  "2606:4700:4700::1111%en0", "127.1", "2130706433", "0x7f000001", "0127.0.0.1", "bad", "", null,
]) assert.equal(isPublicAddress(address), false, `Private/reserved address accepted: ${address}`);
assert.equal(isPublicAddress("8.8.8.8", ["8.8.8.8"]), false, "A public host-interface address must be denied.");
assert.equal(isPublicAddress("8.8.8.8", ["::ffff:8.8.8.8"]), false, "A mapped host-interface alias must be denied.");
assert.equal(isPublicAddress("2606:4700:4700::1111", ["2606:4700:4700:0:0:0:0:1111"]), false, "Equivalent IPv6 interface spelling must be denied.");

async function request(port, raw) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let output = "";
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error("Proxy test request timed out.")); });
    socket.on("error", reject);
    socket.on("data", chunk => { output += chunk.toString(); assert(output.length < 16384); });
    socket.on("close", () => resolve(output));
    socket.once("connect", () => socket.write(raw));
  });
}

async function canBindUdp(port) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
  return new Promise(resolve => {
    socket.once("error", () => { try { socket.close(); } catch {} resolve(false); });
    socket.bind({ address: "127.0.0.1", port, exclusive: true }, () => socket.close(() => resolve(true)));
  });
}

async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Proxy test operation timed out.")), 2000); })]);
  } finally { clearTimeout(timer); }
}

const proxy = await startReviewProxy({ allowedHosts: hosts, deadline: Date.now() + 20000 });
try {
  assert(Number.isInteger(proxy.port) && proxy.port > 0);
  assert.equal(await canBindUdp(proxy.port), false, "The allowed localhost port must also reserve UDP.");
  for (const authority of ["127.0.0.1:443", "api.openai.com:80", "api.openai.com.attacker.test:443", "user@api.openai.com:443", "API.OPENAI.COM:443"]) {
    const response = await request(proxy.port, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    assert.match(response, /^HTTP\/1\.1 403 /);
    assert(!response.includes(authority), "Rejected authority leaked in response.");
  }
  assert.match(await request(proxy.port, "GET http://api.openai.com/secret HTTP/1.1\r\nHost: api.openai.com\r\n\r\n"), /^HTTP\/1\.1 405 /);
  assert.match(await request(proxy.port, "CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com\r\nContent-Length: 1\r\n\r\nx"), /^HTTP\/1\.1 403 /);
  assert.match(await request(proxy.port, "invalid request\r\n\r\n"), /^HTTP\/1\.1 400 /);
  assert.match(await request(proxy.port, `CONNECT api.openai.com:443 HTTP/1.1\r\nX-Large: ${"x".repeat(REVIEW_PROXY_LIMITS.headerBytes + 1)}\r\n\r\n`), /^HTTP\/1\.1 431 /);

  // Replace DNS/network methods only in this test process. Production accepts
  // no injected resolver, connection callback or environment verification flag.
  const resolve4 = Resolver.prototype.resolve4;
  const resolve6 = Resolver.prototype.resolve6;
  const connect = net.connect;
  const interfaces = os.networkInterfaces;
  try {
    os.networkInterfaces = () => ({ lo: [{ address: "127.0.0.1" }], public: [{ address: "9.9.9.9" }] });
    Resolver.prototype.resolve6 = async () => [];
    for (const addresses of [["127.0.0.1"], ["10.0.0.1"], ["8.8.8.8", "127.0.0.1"], ["::ffff:8.8.8.8"], ["9.9.9.9"]]) {
      Resolver.prototype.resolve4 = async () => addresses;
      assert.match(await request(proxy.port, "CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n"), /^HTTP\/1\.1 502 /);
    }
    Resolver.prototype.resolve4 = async () => { throw new Error("private DNS error detail"); };
    const failure = await request(proxy.port, "CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n");
    assert.match(failure, /^HTTP\/1\.1 502 /);
    assert(!failure.includes("private DNS error detail"));

    Resolver.prototype.resolve4 = async () => ["8.8.8.8"];
    os.networkInterfaces = () => { throw new Error("Host interface inspection unavailable"); };
    assert.match(await request(proxy.port, "CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n"), /^HTTP\/1\.1 502 /);
    os.networkInterfaces = () => ({ lo: [{ address: "127.0.0.1" }] });

    const destinations = [];
    const tunnelWrites = [];
    Resolver.prototype.resolve4 = async () => ["8.8.8.8"];
    net.connect = function(options, ...rest) {
      if (options.port !== 443) return connect.call(this, options, ...rest);
      destinations.push(options);
      const upstream = new Duplex({ read() {}, write(chunk, _encoding, done) { tunnelWrites.push(chunk.toString()); done(); } });
      upstream.setTimeout = () => upstream;
      queueMicrotask(() => {
        upstream.emit("connect");
        upstream.push("bounded upstream reply");
        upstream.push(null);
      });
      return upstream;
    };
    const success = await request(proxy.port, "CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\ninitial tunnel bytes");
    assert.match(success, /^HTTP\/1\.1 200 Connection Established/, JSON.stringify({ destinations, tunnelWrites }));
    assert(success.includes("bounded upstream reply"));
    assert.deepEqual(destinations, [{ host: "8.8.8.8", family: 4, port: 443 }], "Connection must pin the inspected numeric address.");
    assert.equal(tunnelWrites.join(""), "initial tunnel bytes", "CONNECT head bytes must be forwarded once.");

    let interfaceReads = 0;
    os.networkInterfaces = () => {
      if (++interfaceReads === 2) throw new Error("Interface inspection failed during connect callback");
      return { lo: [{ address: "127.0.0.1" }] };
    };
    const connectFailure = await request(proxy.port, "CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n");
    assert.equal(interfaceReads, 2, "Exercise the asynchronous connect callback, after DNS validation.");
    assert(!connectFailure.includes("200 Connection Established"), "A post-connect inspection error must refuse the tunnel without crashing.");
    os.networkInterfaces = () => ({ lo: [{ address: "127.0.0.1" }] });
    net.connect = connect;

    const releases = [];
    let lookupSeen;
    Resolver.prototype.resolve4 = () => new Promise(resolve => {
      releases.push(() => resolve(["8.8.8.8"]));
      lookupSeen();
    });
    try {
      for (let i = 0; i < REVIEW_PROXY_LIMITS.clients; i += 1) {
        const seen = new Promise(resolve => { lookupSeen = resolve; });
        const socket = net.connect({ host: "127.0.0.1", port: proxy.port });
        socket.on("error", () => {});
        try {
          await once(socket, "connect");
          socket.write("CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n");
          await within(seen);
        } finally { if (!socket.destroyed) socket.resetAndDestroy(); }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.match(await request(proxy.port, "CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n"), /^HTTP\/1\.1 503 /);
      assert.equal(releases.length, REVIEW_PROXY_LIMITS.clients, "Abandoned clients must not permit unlimited pending DNS.");
    } finally {
      for (const release of releases) release();
      await new Promise(resolve => setImmediate(resolve));
    }
  } finally {
    Resolver.prototype.resolve4 = resolve4;
    Resolver.prototype.resolve6 = resolve6;
    net.connect = connect;
    os.networkInterfaces = interfaces;
  }

  const held = [];
  try {
    for (let i = 0; i < REVIEW_PROXY_LIMITS.clients; i += 1) {
      const socket = net.connect({ host: "127.0.0.1", port: proxy.port });
      socket.on("error", () => {});
      held.push(socket);
      await once(socket, "connect");
    }
    assert.equal(await request(proxy.port, "GET / HTTP/1.1\r\nHost: example.test\r\n\r\n"), "", "Connection limit must reject excess sockets.");
    await proxy.close();
    await proxy.close();
    await Promise.all(held.map(socket => socket.destroyed ? Promise.resolve() : once(socket, "close")));
  } finally { for (const socket of held) socket.destroy(); }
} finally { await proxy.close(); }

await assert.rejects(startReviewProxy({ allowedHosts: hosts, deadline: Date.now() - 1 }), /deadline/);
await assert.rejects(startReviewProxy({ allowedHosts: hosts, deadline: Date.now() + 7200000 }), /deadline/);
// A real UDP conflict must fail startup and release the already-open TCP port.
const occupied = dgram.createSocket({ type: "udp4", reuseAddr: false });
await new Promise(resolve => occupied.bind({ address: "127.0.0.1", port: 0, exclusive: true }, resolve));
const occupiedPort = occupied.address().port;
const listen = http.Server.prototype.listen;
try {
  http.Server.prototype.listen = function(options, ...rest) {
    return listen.call(this, { ...options, port: occupiedPort }, ...rest);
  };
  await assert.rejects(startReviewProxy({ allowedHosts: hosts, deadline: Date.now() + 5000 }), /reserve/);
  const freeTcp = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      freeTcp.once("error", reject);
      freeTcp.listen({ host: "127.0.0.1", port: occupiedPort }, resolve);
    });
  } finally { await new Promise(resolve => freeTcp.close(resolve)); }
} finally {
  http.Server.prototype.listen = listen;
  await new Promise(resolve => occupied.close(resolve));
}
const expiring = await startReviewProxy({ allowedHosts: hosts, deadline: Date.now() + 150 });
const held = net.connect({ host: "127.0.0.1", port: expiring.port });
held.on("error", () => {});
const timer = setTimeout(() => { held.destroy(); throw new Error("Proxy deadline did not close its connections."); }, 3000);
try {
  await once(held, "connect");
  await once(held, "close");
  assert.equal(await canBindUdp(expiring.port), false, "Deadline expiry must retain the allowed UDP port until the owner stops its provider.");
  assert.equal(await request(expiring.port, "GET / HTTP/1.1\r\nHost: example.test\r\n\r\n"), "", "Expired proxy must drop traffic while retaining the TCP port.");
  await expiring.close();
} finally { clearTimeout(timer); held.destroy(); await expiring.close(); }
console.log("Review sandbox proxy smoke passed: exact endpoints, IP boundaries, HTTP rejection, limits and cleanup.");
