import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const delay = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export function parseSshLoginCommand(command) {
  if (typeof command !== "string" || !command.trim()) {
    throw new Error("优云没有返回 SSH 登录命令");
  }

  const tokens = command.trim().split(/\s+/);
  if (tokens[0]?.split("/").pop() !== "ssh") {
    throw new Error("优云返回了无法识别的 SSH 登录命令");
  }

  let port = 22;
  let destination;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-p") {
      port = Number(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (/^-p\d+$/.test(token)) {
      port = Number(token.slice(2));
      continue;
    }
    if (!token.startsWith("-") && token.includes("@")) destination = token;
  }

  const separator = destination?.indexOf("@") ?? -1;
  const user = separator > 0 ? destination.slice(0, separator) : "";
  const host = separator > 0 ? destination.slice(separator + 1) : "";
  if (!user || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("优云返回了无法识别的 SSH 登录地址");
  }

  return { user, host, port };
}

export function decodeCompSharePassword(value) {
  if (typeof value !== "string") return value;
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return value;
  }
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (
      !decoded ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(decoded) ||
      Buffer.from(decoded, "utf8").toString("base64") !== value
    ) {
      return value;
    }
    return decoded;
  } catch {
    return value;
  }
}

export function buildSshTunnelArgs({
  user,
  host,
  port,
  localHost,
  localPort,
  remoteHost,
  remotePort,
  knownHostsPath,
}) {
  return [
    "-N",
    "-T",
    "-p",
    String(port),
    "-L",
    `${localHost}:${localPort}:${remoteHost}:${remotePort}`,
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ConnectTimeout=20",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${knownHostsPath}`,
    "-o",
    "PreferredAuthentications=password,keyboard-interactive",
    "-o",
    "PubkeyAuthentication=no",
    "-o",
    "NumberOfPasswordPrompts=1",
    `${user}@${host}`,
  ];
}

async function allocateLocalPort(host) {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, host, resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, rejectPromise) =>
    server.close((error) => (error ? rejectPromise(error) : resolvePromise())),
  );
  if (!address || typeof address === "string") {
    throw new Error("无法分配 SSH 隧道本地端口");
  }
  return address.port;
}

function canConnect(host, port) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port });
    const finish = (connected) => {
      socket.destroy();
      resolvePromise(connected);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return Promise.race([
    new Promise((resolvePromise) => child.once("exit", () => resolvePromise(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

export async function openSshTunnel({
  user,
  host,
  port = 22,
  password,
  resourceId,
  remoteHost = "127.0.0.1",
  remotePort = 8188,
  localHost = "127.0.0.1",
  localPort,
  connectTimeoutMs = 30_000,
  sshPath = process.platform === "win32" ? "ssh.exe" : "/usr/bin/ssh",
  knownHostsPath,
} = {}) {
  if (!user || !host || !password || !resourceId) {
    throw new Error("SSH 隧道缺少连接信息");
  }
  if (password.includes("\0") || password.includes("\n")) {
    throw new Error("SSH 密码包含不支持的字符");
  }

  const selectedLocalPort = localPort ?? (await allocateLocalPort(localHost));
  const safeResourceId = resourceId.replace(/[^A-Za-z0-9._-]/g, "_");
  const selectedKnownHostsPath =
    knownHostsPath ??
    join(homedir(), ".local", "state", "minimax-h3-cloud", "known-hosts", safeResourceId);
  await mkdir(join(selectedKnownHostsPath, ".."), {
    recursive: true,
    mode: 0o700,
  });

  const askpassDir = await mkdtemp(join(tmpdir(), "minimax-h3-askpass-"));
  let askpassPath;
  if (process.platform === "win32") {
    askpassPath = join(askpassDir, "askpass.cmd");
    await writeFile(
      askpassPath,
      "@echo off\r\necho %MINIMAX_H3_SSH_PASSWORD%\r\n",
    );
  } else {
    askpassPath = join(askpassDir, "askpass.sh");
    await writeFile(
      askpassPath,
      '#!/bin/sh\nprintf "%s\\n" "$MINIMAX_H3_SSH_PASSWORD"\n',
      { mode: 0o700 },
    );
  }

  const args = buildSshTunnelArgs({
    user,
    host,
    port,
    localHost,
    localPort: selectedLocalPort,
    remoteHost,
    remotePort,
    knownHostsPath: selectedKnownHostsPath,
  });
  const child = spawn(sshPath, args, {
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || "minimax-h3-cloud",
      SSH_ASKPASS: askpassPath,
      SSH_ASKPASS_REQUIRE: "force",
      MINIMAX_H3_SSH_PASSWORD: password,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  let spawnError;
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      if (!(await waitForExit(child, 2_000))) {
        child.kill("SIGKILL");
        await waitForExit(child, 1_000);
      }
    }
    await rm(askpassDir, { recursive: true, force: true });
  };

  try {
    const deadline = Date.now() + connectTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(stderr.trim() || "SSH 隧道进程提前退出");
      }
      if (await canConnect(localHost, selectedLocalPort)) {
        return {
          url: `http://${localHost}:${selectedLocalPort}`,
          localHost,
          localPort: selectedLocalPort,
          remoteHost,
          remotePort,
          close,
        };
      }
      await delay(100);
    }
    throw new Error(stderr.trim() || "等待 SSH 隧道就绪超时");
  } catch (error) {
    await close();
    const tunnelError = new Error(`建立 SSH 隧道失败：${error.message}`);
    tunnelError.code = "SSH_TUNNEL_FAILED";
    tunnelError.cause = error;
    throw tunnelError;
  }
}
