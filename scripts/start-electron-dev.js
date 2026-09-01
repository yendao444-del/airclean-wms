const http = require('http');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronEntry = path.join(projectRoot, 'node_modules', 'electron', 'cli.js');
const staleElectronApp = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'resources', 'app');
const launcherReplacedMarker = path.join(projectRoot, 'tmp', 'start-launcher-replaced.flag');
const candidatePorts = Array.from({ length: 18 }, (_, index) => 5173 + index);
const dbyPageMarker = '<title>DBY POS - Warehouse Management System</title>';
const DATA_SAFETY_MODE = true;
const launcherId = crypto
  .createHash('sha256')
  .update(projectRoot.toLowerCase())
  .digest('hex')
  .slice(0, 16);
const launcherPipe = `\\\\.\\pipe\\dby-pos-dev-${launcherId}`;
const startedAt = Date.now();
const children = new Set();
let launcherLock = null;
let shuttingDown = false;

function elapsed() {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function quarantineStaleElectronApp() {
  if (DATA_SAFETY_MODE) {
    console.log('[DataSafety] Skipped Electron cache quarantine.');
    return;
  }
  if (!fs.existsSync(staleElectronApp)) return;

  const quarantinedPath = `${staleElectronApp}.stale-${Date.now()}`;
  try {
    fs.renameSync(staleElectronApp, quarantinedPath);
  } catch (error) {
    console.warn(`[START] Could not move stale Electron cache: ${error.message}`);
    return;
  }
  console.log('[START] Moved stale Electron app cache out of the startup path');
  console.log(`[START] Preserved the quarantined cache at ${quarantinedPath}`);
}

function acquireLauncherLock() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.once('data', (command) => {
        if (command.trim() === 'identify') {
          socket.end(String(process.pid));
          return;
        }
        socket.end('ok');
      });
    });
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        const socket = net.createConnection(launcherPipe);
        let response = '';
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        socket.setTimeout(2000);
        socket.setEncoding('utf8');
        socket.once('connect', () => socket.end('identify'));
        socket.on('data', (chunk) => { response += chunk; });
        socket.once('end', () => {
          const existingPid = Number(response.trim());
          if (!Number.isInteger(existingPid) || existingPid < 1 || existingPid === process.pid) {
            reject(new Error('Existing launcher did not return a valid process id.'));
            return;
          }
          console.log(`[START] Replacing launcher PID ${existingPid} so this window owns the logs...`);
          fs.mkdirSync(path.dirname(launcherReplacedMarker), { recursive: true });
          fs.writeFileSync(launcherReplacedMarker, `${Date.now()}\n`, 'utf8');
          const markerCleanupTimer = setTimeout(() => {
            fs.rmSync(launcherReplacedMarker, { force: true });
          }, 5000);
          markerCleanupTimer.unref?.();
          const killer = spawn('taskkill.exe', ['/pid', String(existingPid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          // taskkill can return a non-zero code when Electron children exit
          // while it is walking the tree. Retrying the named-pipe lock is the
          // authoritative check that the previous launcher has gone away.
          killer.once('exit', () => finish(false));
        });
        socket.once('error', () => {
          console.log('[START] Existing launcher disappeared; retrying...');
          finish(false);
        });
        socket.once('timeout', () => {
          socket.destroy();
          finish(false);
        });
        return;
      }
      reject(error);
    });
    server.listen(launcherPipe, () => {
      launcherLock = server;
      resolve(true);
    });
  });
}

function startNode(entry, args, label, envOverrides = {}) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...envOverrides },
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`[${label}] exited (${signal || code}) after ${elapsed()}`);
      shutdown(code || 1);
    }
  });
  return child;
}

function readDevServerPage(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 10000) body += chunk;
      });
      response.on('end', () => resolve(body));
    });
    request.setTimeout(500, () => request.destroy());
    request.on('error', () => resolve(''));
  });
}

async function isDbyDevServer(url) {
  const page = await readDevServerPage(url);
  return page.includes(dbyPageMarker) && page.includes('/src/main.tsx');
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(false));
    tester.listen({ host: '127.0.0.1', port }, () => {
      tester.close(() => resolve(true));
    });
  });
}

async function findRunningDbyServer() {
  const probes = await Promise.all(candidatePorts.map(async (port) => {
    const url = `http://127.0.0.1:${port}`;
    return (await isDbyDevServer(url)) ? { port, url } : null;
  }));
  return probes.find(Boolean) || null;
}

async function findFreePort() {
  for (const port of candidatePorts) {
    if (await isPortFree(port)) return port;
  }
  throw new Error('No free development port found between 5173 and 5190.');
}

async function waitForDevServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDbyDevServer(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function terminateTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) terminateTree(child);
  launcherLock?.close();
  launcherLock = null;
  setTimeout(() => process.exit(exitCode), 250).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) terminateTree(child);
});

async function main() {
  let tookOverExistingLauncher = false;
  while (!(await acquireLauncherLock())) {
    tookOverExistingLauncher = true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (tookOverExistingLauncher) {
    // taskkill normally waits for the old tree, but verify its Vite listener is
    // gone before deciding whether to reuse or start a server.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await findRunningDbyServer())) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  quarantineStaleElectronApp();

  const runningServer = await findRunningDbyServer();
  let devServerUrl;

  if (runningServer) {
    devServerUrl = runningServer.url;
    console.log(`[START] Reusing the DBY POS server at ${devServerUrl}`);
  } else {
    const port = await findFreePort();
    devServerUrl = `http://127.0.0.1:${port}`;
    console.log(`[START] Launching Vite at ${devServerUrl}`);
    startNode(viteEntry, ['--host', '127.0.0.1', '--port', String(port), '--strictPort', '--clearScreen', 'false'], 'VITE');

    if (!(await waitForDevServer(devServerUrl))) {
      throw new Error('Vite did not become ready within 30 seconds.');
    }
  }

  console.log(`[START] Vite ready after ${elapsed()}; launching Electron`);
  const electron = startNode(electronEntry, ['.'], 'ELECTRON', {
    DBYPOS_VITE_DEV_SERVER_URL: devServerUrl,
  });
  electron.once('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[START] Electron closed after ${elapsed()}; stopping the development server.`);
      shutdown(code || 0);
    }
  });
}

main().catch((error) => {
  console.error(`[START] ${error.message}`);
  shutdown(1);
});
