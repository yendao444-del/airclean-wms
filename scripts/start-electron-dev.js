const http = require('http');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronEntry = path.join(projectRoot, 'node_modules', 'electron', 'cli.js');
const prismaEntry = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const prismaSchema = path.join(projectRoot, 'prisma', 'schema.prisma');
const generatedPrismaSchema = path.join(projectRoot, 'node_modules', '.prisma', 'client', 'schema.prisma');
const staleElectronApp = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'resources', 'app');
const electronAppQuarantineDir = path.join(projectRoot, 'tmp', 'electron-resource-app-quarantine');
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
let electronChild = null;
let electronRestartTimer = null;
let electronRestartRequested = false;
const electronWatchers = [];
const fastStart = process.env.DBYPOS_FAST_START === '1';

function elapsed() {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function quarantineStaleElectronApp() {
  if (!fs.existsSync(staleElectronApp)) return;

  // resources/app turns the development Electron binary into a packaged app
  // and makes it ignore the project passed on the command line. Preserve the
  // generated copy outside Electron's resources directory so it can be
  // inspected or restored without allowing it to shadow the working tree.
  fs.mkdirSync(electronAppQuarantineDir, { recursive: true });
  const quarantinedPath = path.join(electronAppQuarantineDir, `app-${Date.now()}`);
  try {
    fs.renameSync(staleElectronApp, quarantinedPath);
  } catch (error) {
    console.warn(`[START] Could not move stale Electron cache: ${error.message}`);
    return;
  }
  console.log('[START] Quarantined generated Electron resources/app so the working tree starts');
  console.log(`[START] Preserved the quarantined cache at ${quarantinedPath}`);
}

function ensurePrismaClientSynced() {
  const normalizeSchema = (value) => value.replace(/\r\n/g, '\n').trim();
  const sourceSchema = normalizeSchema(fs.readFileSync(prismaSchema, 'utf8'));
  const generatedSchema = fs.existsSync(generatedPrismaSchema)
    ? normalizeSchema(fs.readFileSync(generatedPrismaSchema, 'utf8'))
    : '';
  if (sourceSchema === generatedSchema) return Promise.resolve();

  console.log('[START] Prisma schema changed; regenerating Prisma Client...');
  return new Promise((resolve, reject) => {
    const generator = spawn(process.execPath, [prismaEntry, 'generate', '--schema', prismaSchema], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    generator.once('error', reject);
    generator.once('exit', (code) => {
      if (code === 0) {
        console.log('[START] Prisma Client is synchronized.');
        resolve();
        return;
      }
      reject(new Error(`Prisma Client generation failed with exit code ${code}.`));
    });
  });
}

function getLatestMtime(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let latest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    latest = Math.max(latest, getLatestMtime(path.join(targetPath, entry.name)));
  }
  return latest;
}

function runNode(entry, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(entry)} exited with code ${code}.`));
    });
  });
}

async function ensureRendererBuild() {
  const distIndex = path.join(projectRoot, 'dist', 'index.html');
  const distMtime = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
  const sourceMtime = Math.max(
    getLatestMtime(path.join(projectRoot, 'src')),
    getLatestMtime(path.join(projectRoot, 'public')),
    ...[
      'index.html',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.app.json',
      'vite.config.ts',
    ].map((file) => getLatestMtime(path.join(projectRoot, file))),
  );
  if (distMtime >= sourceMtime) {
    console.log(`[START] Reusing fresh production renderer after ${elapsed()}`);
    return;
  }

  console.log('[START] Renderer source changed; refreshing the production build once...');
  // START is a runtime launcher, not the release validation pipeline. Vite
  // transpiles the renderer needed to run; `npm run build` remains the place
  // that performs the full TypeScript check before packaging/release.
  await runNode(viteEntry, ['build']);
  console.log(`[START] Production renderer ready after ${elapsed()}`);
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

function startViteAndWaitForListener(args) {
  let resolveReady;
  let rejectReady;
  let outputBuffer = '';
  let readySettled = false;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const child = spawn(process.execPath, [viteEntry, ...args], {
    cwd: projectRoot,
    env: process.env,
    // Keep the terminal output visible while also observing Vite's own
    // listening banner. Waiting for an HTTP GET made the launcher trigger the
    // first dependency transform itself and delayed Electron by several seconds.
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.add(child);

  const finishReady = (error) => {
    if (readySettled) return;
    readySettled = true;
    clearTimeout(readyTimer);
    if (error) rejectReady(error);
    else resolveReady();
  };
  const inspectOutput = (chunk, target) => {
    target.write(chunk);
    outputBuffer = `${outputBuffer}${chunk.toString('utf8')}`
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .slice(-8192);
    if (/\bLocal:\s+https?:\/\/127\.0\.0\.1:\d+/i.test(outputBuffer)
      || /\bready in\s+\d+(?:\.\d+)?\s*ms/i.test(outputBuffer)) {
      finishReady();
    }
  };
  child.stdout.on('data', (chunk) => inspectOutput(chunk, process.stdout));
  child.stderr.on('data', (chunk) => inspectOutput(chunk, process.stderr));
  child.once('error', (error) => finishReady(error));
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!readySettled) {
      finishReady(new Error(`VITE exited before listening (${signal || code})`));
    }
    if (!shuttingDown && code !== 0) {
      console.error(`[VITE] exited (${signal || code}) after ${elapsed()}`);
      shutdown(code || 1);
    }
  });
  const readyTimer = setTimeout(() => {
    finishReady(new Error('Vite did not announce a listening server within 30 seconds.'));
  }, 30000);
  readyTimer.unref?.();
  return { child, ready };
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

function launchElectron({ devServerUrl, useBuiltRenderer = false }) {
  const child = spawn(process.execPath, [electronEntry, projectRoot], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(devServerUrl ? { DBYPOS_VITE_DEV_SERVER_URL: devServerUrl } : {}),
      DBYPOS_USE_DIST: useBuiltRenderer ? '1' : '0',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  electronChild = child;
  children.add(child);
  child.once('exit', (code) => {
    children.delete(child);
    if (electronChild === child) electronChild = null;
    if (shuttingDown) return;
    if (electronRestartRequested) {
      electronRestartRequested = false;
      console.log(`[START] Electron backend updated; restarting after ${elapsed()}...`);
      launchElectron({ devServerUrl, useBuiltRenderer });
      return;
    }
    console.log(`[START] Electron closed after ${elapsed()}; stopping the development server.`);
    shutdown(code || 0);
  });
}

function watchElectronBackend({ devServerUrl, useBuiltRenderer = false }) {
  const watchedFiles = [
    'main.js',
    'preload.js',
    'ipc-handlers.js',
    'packing-read-model.js',
    'update-handlers.js',
    'offline-queue.js',
  ];
  for (const filename of watchedFiles) {
    const filePath = path.join(projectRoot, 'electron', filename);
    if (!fs.existsSync(filePath)) continue;
    const getSignature = () => {
      try {
        const stat = fs.statSync(filePath);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return null;
      }
    };
    let lastSignature = getSignature();
    const watcher = fs.watch(filePath, () => {
      clearTimeout(electronRestartTimer);
      electronRestartTimer = setTimeout(() => {
        if (!electronChild || electronRestartRequested || shuttingDown) return;
        const nextSignature = getSignature();
        if (!nextSignature || nextSignature === lastSignature) return;
        lastSignature = nextSignature;
        electronRestartRequested = true;
        console.log(`[START] ${filename} changed; restarting Electron (Vite remains running)...`);
        terminateTree(electronChild);
      }, 250);
    });
    electronWatchers.push(watcher);
  }
  console.log('[START] Watching Electron backend/preload files for automatic restart');
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(electronRestartTimer);
  for (const watcher of electronWatchers) watcher.close();
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
  await ensurePrismaClientSynced();

  if (fastStart) {
    await ensureRendererBuild();
    console.log(`[START] Launching Electron with the production renderer after ${elapsed()}`);
    launchElectron({ useBuiltRenderer: true });
    watchElectronBackend({ useBuiltRenderer: true });
    return;
  }

  const runningServer = await findRunningDbyServer();
  let devServerUrl;

  if (runningServer) {
    devServerUrl = runningServer.url;
    console.log(`[START] Reusing the DBY POS server at ${devServerUrl}`);
  } else {
    const port = await findFreePort();
    devServerUrl = `http://127.0.0.1:${port}`;
    console.log(`[START] Launching Vite at ${devServerUrl}`);
    const vite = startViteAndWaitForListener([
      '--host', '127.0.0.1',
      '--port', String(port),
      '--strictPort',
      '--clearScreen', 'false',
    ]);
    await vite.ready;
  }

  console.log(`[START] Vite ready after ${elapsed()}; launching Electron`);
  launchElectron({ devServerUrl });
  watchElectronBackend({ devServerUrl });
}

const startPromise = process.argv.includes('--verify-fast-build')
  ? ensureRendererBuild()
  : main();

startPromise.catch((error) => {
  console.error(`[START] ${error.message}`);
  shutdown(1);
});
