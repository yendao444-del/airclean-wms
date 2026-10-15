const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args[0]} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function prepareExistingArtifact(version, directory = process.cwd()) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a version such as 1.0.488.');
  const root = path.resolve(directory);
  const name = `DBYPOS-PATCH-v${version}.zip`;
  const candidates = [path.join(root, name), path.join(root, `${name}.sha256`)];
  const existing = candidates.filter((file) => fs.existsSync(file));
  if (!existing.length) return { status: 'none' };
  if (existing.length === 2) return { status: 'pair' };
  // Preserve incomplete output from an interrupted build. A fresh private
  // directory prevents overwriting older evidence; never delete a stale ZIP.
  if (!fs.lstatSync(existing[0]).isFile()) throw new Error(`Expected a regular release file: ${existing[0]}`);
  const temporaryRoot = path.join(root, 'tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const backup = fs.mkdtempSync(path.join(temporaryRoot, `release-stale-v${version}-`));
  const destination = path.join(backup, path.basename(existing[0]));
  fs.renameSync(existing[0], destination);
  return { status: 'archived', destination };
}

function validateArtifact(version, archivePath) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a version such as 1.0.488.');
  const zipPath = path.resolve(archivePath);
  const zipName = `DBYPOS-PATCH-v${version}.zip`;
  if (path.basename(zipPath) !== zipName) throw new Error('ZIP filename does not match version.');
  const zipBytes = fs.readFileSync(zipPath);
  const checksumPath = `${zipPath}.sha256`;
  const checksumBytes = fs.readFileSync(checksumPath);
  const match = checksumBytes.toString('utf8').replace(/^\uFEFF/, '').trim()
    .match(/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i);
  if (!match || match[2] !== zipName || match[1].toLowerCase() !== hash(zipBytes)) {
    throw new Error('ZIP and SHA256 do not match.');
  }
  // Inspect the archive itself; the working tree may have changed since build.
  const zip = new (require('adm-zip'))(zipBytes);
  const entries = new Map();
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (entries.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    entries.set(name, entry);
  }
  for (const name of [
    'package.json', 'dist/index.html', 'electron/main.js', 'electron/preload.js',
    'electron/ipc-handlers.js', 'node_modules/ws/index.js',
    'node_modules/@zxing/browser/umd/zxing-browser.min.js',
    'node_modules/cloudflared/bin/cloudflared.exe',
  ]) {
    const entry = entries.get(`resources/app/${name}`);
    if (!entry || entry.isDirectory || !entry.header.size) throw new Error(`Incomplete ZIP: ${name}`);
  }
  const pkg = JSON.parse(entries.get('resources/app/package.json').getData().toString('utf8'));
  if (pkg.version !== version) throw new Error('Version inside ZIP does not match release.');
  return [
    { name: zipName, path: zipPath, size: zipBytes.length, digest: `sha256:${hash(zipBytes)}` },
    { name: `${zipName}.sha256`, path: checksumPath, size: checksumBytes.length, digest: `sha256:${hash(checksumBytes)}` },
  ];
}

function resolveTarget(version, execute = run) {
  const target = execute('git', [
    'log', '-1', '--format=%H', `--grep=^v${version.replace(/\./g, '\\.')} - `,
  ]).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(target)) throw new Error(`No release commit found for v${version}.`);
  const pkg = JSON.parse(execute('git', ['show', `${target}:package.json`]).stdout);
  if (pkg.version !== version) throw new Error('Release commit version does not match ZIP.');
  return target;
}

function publishRelease({ version, assets, target, remote }, execute = run, log = console.log) {
  const match = remote.trim().match(/^(?:https:\/\/|ssh:\/\/git@|git@)([^/:]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error('Cannot identify origin repository.');
  const [, host, owner, repo] = match;
  const repository = `${host}/${owner}/${repo}`;
  const apiRoot = `repos/${owner}/${repo}`;
  const tag = `v${version}`;
  const api = (endpoint) => JSON.parse(execute('gh', ['api', endpoint, '--hostname', host]).stdout);
  const view = () => {
    const result = execute('gh', ['release', 'view', tag, '--repo', repository,
      '--json', 'databaseId,isDraft'], true);
    if (result.status !== 0) {
      if (/release not found/i.test(result.stderr || '')) return null;
      throw new Error(`Cannot inspect release: ${result.stderr || result.stdout}`);
    }
    return JSON.parse(result.stdout);
  };
  if (api(`${apiRoot}/commits/${target}`).sha !== target) throw new Error('Release commit is not on origin.');
  let release = view();
  if (release && !release.isDraft) throw new Error(`${tag} is already published; assets will not be replaced.`);
  // Existing tags must agree with the release commit, including annotated tags.
  const tagRef = execute('gh', ['api', `${apiRoot}/git/ref/tags/${tag}`, '--hostname', host], true);
  if (tagRef.status === 0) {
    if (api(`${apiRoot}/commits/${tag}`).sha !== target) throw new Error('Existing tag points to another commit.');
  } else if (!/HTTP 404/.test(tagRef.stderr || '')) {
    throw new Error(`Cannot inspect tag: ${tagRef.stderr || tagRef.stdout}`);
  }
  if (!release) {
    execute('gh', ['release', 'create', tag, '--repo', repository, '--draft', '--target', target,
      '--title', `DBY POS ${tag} (PATCH)`, '--notes', 'Patch update - Bug fixes and improvements']);
    release = view();
  }
  if (!release?.isDraft) throw new Error('Cannot confirm draft release.');
  // Pin resumed drafts to a commit rather than a branch that can move.
  execute('gh', ['release', 'edit', tag, '--repo', repository, '--target', target]);
  for (const asset of assets) {
    const current = view();
    if (!current?.isDraft || current.databaseId !== release.databaseId) throw new Error('Draft changed during upload.');
    log(`[Release] Uploading ${asset.name}...`);
    execute('gh', ['release', 'upload', tag, asset.path, '--repo', repository, '--clobber']);
  }
  const staged = api(`${apiRoot}/releases/${release.databaseId}`);
  if (!staged.draft) throw new Error('Release is no longer a draft.');
  for (const asset of assets) {
    const uploaded = staged.assets.filter((candidate) => candidate.name === asset.name);
    if (uploaded.length !== 1 || uploaded[0].state !== 'uploaded' ||
        uploaded[0].size !== asset.size || uploaded[0].digest !== asset.digest) {
      throw new Error(`Remote asset verification failed: ${asset.name}. Draft kept; not published.`);
    }
  }
  execute('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
  const published = view();
  if (!published || published.isDraft) throw new Error('Cannot confirm publication. Local files kept.');
  log(`[Release] Published ${tag} with verified ZIP and SHA256.`);
}

function main(args) {
  if (args[0] === '--prepare-existing') {
    const version = args[1];
    const result = prepareExistingArtifact(version);
    if (result.status === 'pair') {
      throw new Error(`ZIP and checksum already exist. To continue: updates\\RELEASE-ver3.bat --resume ${version}`);
    }
    if (result.status === 'archived') console.log(`[Release] Incomplete previous output preserved at ${result.destination}. Continuing fresh build.`);
    return;
  }
  const verifyOnly = args[0] === '--verify-only';
  if (verifyOnly) args = args.slice(1);
  const [version, archivePath] = args;
  if (!version || !archivePath) throw new Error('Usage: node scripts/release-publish.cjs [--verify-only] <version> <zip>');
  const assets = validateArtifact(version, archivePath);
  run(process.execPath, [path.join(__dirname, 'verify-release-archive-secrets.cjs'), assets[0].path]);
  if (verifyOnly) {
    console.log(`[Release] ZIP layout, embedded version and checksum verified: v${version}`);
    return;
  }
  const target = resolveTarget(version);
  const remote = run('git', ['remote', 'get-url', 'origin']).stdout.trim();
  publishRelease({ version, assets, target, remote });
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(`[Release] ERROR: ${error.message}`);
    console.error('[Release] Local files kept. Retry with RELEASE-ver3.bat --resume <version>.');
    process.exitCode = 1;
  }
}

module.exports = { prepareExistingArtifact, validateArtifact, resolveTarget, publishRelease };
