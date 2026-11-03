#!/usr/bin/env node
// Trusted nondestructive verification. This runs under the same outer profile
// as Codex, deliberately without Codex's own command sandbox.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawnSync } from "node:child_process";

const DENIED = new Set(["EPERM", "EACCES", "EROFS"]);
const MAX_READ_BYTES = 32 * 1024 * 1024;
function readBoundedRecord(file, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_READ_BYTES) throw new Error();
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size > maximum) throw new Error();
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(descriptor, buffer, size, buffer.length - size, size);
      if (!count) break;
      size += count;
    }
    const after = fs.fstatSync(descriptor);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || after.uid !== before.uid
        || after.nlink !== before.nlink || after.dev !== before.dev || after.ino !== before.ino) throw new Error();
    return { bytes: buffer.subarray(0, size), stat: after };
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function readBoundedFile(file, maximum) { return readBoundedRecord(file, maximum).bytes; }
function sameRuntimeState(expected, record) {
  return expected && typeof expected === "object" && !Array.isArray(expected)
    && ["dev", "ino", "uid", "mode", "nlink", "size"].every(key => record.stat[key] === expected[key])
    && record.stat.mtimeMs === expected.mtime_ms && record.stat.ctimeMs === expected.ctime_ms
    && crypto.createHash("sha256").update(record.bytes).digest("hex") === expected.sha256;
}
const rejectWrite = operation => {
  try { operation(); return false; }
  catch (error) { return DENIED.has(error.code); }
};
function writableOpen(file) {
  // Deliberately follow the symlink-alias case so the OS must deny the target;
  // nonblocking avoids a substituted FIFO hanging this harmless writable open.
  const descriptor = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
  fs.closeSync(descriptor);
}
function connect(address) {
  return new Promise(resolve => {
    const socket = net.createConnection(address);
    const timer = setTimeout(() => finish(false), 1000);
    const finish = success => { clearTimeout(timer); socket.destroy(); resolve(success); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

try {
  const manifestPath = process.argv[2];
  const manifest = JSON.parse(readBoundedFile(manifestPath, 1024 * 1024).toString("utf8"));
  if (manifest.schema_version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.nonce || "")
      || !Array.isArray(manifest.read_files) || !manifest.read_files.length || manifest.read_files.length > 1024
      || !Array.isArray(manifest.read_directories) || !manifest.read_directories.length || manifest.read_directories.length > 2048
      || !Array.isArray(manifest.protected_files) || !Array.isArray(manifest.protected_directories)) throw new Error();
  const report = {
    schema_version: 1, nonce: manifest.nonce, files_read: 0, directories_read: 0,
    reads_ok: true, writable_opens_denied: true, file_create_denied: true,
    scratch_writable: false, symlink_write_denied: false, hardlink_denied: false,
    descendant_write_denied: false, proxy_reachable: false,
    direct_tcp_denied: false, unix_socket_denied: false,
    runtime_state_open: false,
  };
  let readBytes = 0;
  for (const file of manifest.read_files) {
    try {
      const bytes = readBoundedFile(file.path, MAX_READ_BYTES - readBytes);
      readBytes += bytes.length;
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error();
      report.files_read += 1;
    } catch { report.reads_ok = false; }
  }
  for (const directory of manifest.read_directories) {
    try {
      const handle = fs.opendirSync(directory);
      handle.closeSync();
      report.directories_read += 1;
    } catch { report.reads_ok = false; }
  }
  for (const file of manifest.protected_files) {
    if (!rejectWrite(() => writableOpen(file))) report.writable_opens_denied = false;
  }
  for (const directory of manifest.protected_directories) {
    const file = path.join(directory, manifest.canary_name);
    if (!rejectWrite(() => fs.writeFileSync(file, manifest.nonce, { flag: "wx", mode: 0o600 }))) {
      report.file_create_denied = false;
      try { fs.unlinkSync(file); } catch {}
    }
  }
  const scratchFile = path.join(manifest.scratch, "probe-writable.txt");
  try {
    fs.writeFileSync(scratchFile, manifest.nonce, { flag: "wx", mode: 0o600 });
    report.scratch_writable = readBoundedFile(scratchFile, manifest.nonce.length).toString("utf8") === manifest.nonce;
    fs.unlinkSync(scratchFile);
  } catch { report.scratch_writable = false; }
  const symlink = path.join(manifest.scratch, "probe-symlink");
  try {
    fs.symlinkSync(manifest.sentinel, symlink);
    report.symlink_write_denied = rejectWrite(() => writableOpen(symlink));
    fs.unlinkSync(symlink);
  } catch { report.symlink_write_denied = false; }
  const hardlink = path.join(manifest.scratch, "probe-hardlink");
  report.hardlink_denied = rejectWrite(() => fs.linkSync(manifest.sentinel, hardlink));
  // If an outer profile admitted hard links, do not mutate the linked inode.
  // Reject the profile regardless of whether a later writable open would fail.
  try { fs.unlinkSync(hardlink); } catch {}
  const inherited = spawnSync(process.execPath, ["-e", `
    const fs=require('node:fs');
    try { const fd=fs.openSync(process.argv[1], fs.constants.O_RDWR | fs.constants.O_NONBLOCK); fs.closeSync(fd); process.exit(1); }
    catch (e) { process.exit(['EPERM','EACCES','EROFS'].includes(e.code)?0:2); }
  `, manifest.sentinel], { env: process.env, stdio: "ignore", timeout: 2000 });
  report.descendant_write_denied = !inherited.error && inherited.status === 0;
  let runtimeDescriptor;
  try {
    const runtime = manifest.runtime_state;
    if (!sameRuntimeState(runtime, readBoundedRecord(runtime.path, 256))) throw new Error();
    // Match the existing-file operational open used by Codex installation_id.rs
    // without creating/repairing the ID, truncating it, or writing any bytes.
    runtimeDescriptor = fs.openSync(runtime.path, fs.constants.O_RDWR | fs.constants.O_CREAT
      | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW, 0o644);
    const opened = fs.fstatSync(runtimeDescriptor);
    if (!["dev", "ino", "uid", "mode", "nlink", "size"].every(key => opened[key] === runtime[key])) throw new Error();
    fs.closeSync(runtimeDescriptor);
    runtimeDescriptor = undefined;
    report.runtime_state_open = sameRuntimeState(runtime, readBoundedRecord(runtime.path, 256));
  } catch { report.runtime_state_open = false; }
  finally { if (runtimeDescriptor !== undefined) fs.closeSync(runtimeDescriptor); }
  report.proxy_reachable = await connect({ host: "127.0.0.1", port: manifest.proxy_port });
  report.direct_tcp_denied = !await connect({ host: "127.0.0.1", port: manifest.tcp_port });
  report.unix_socket_denied = !await connect({ path: manifest.unix_path });
  console.log(JSON.stringify(report));
} catch {
  // No input contents, paths, provider settings or native stderr are persisted.
  console.error("Outer sandbox probe failed to produce complete verification evidence.");
  process.exitCode = 1;
}
