const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { validateArtifact, resolveTarget, publishRelease } = require('../scripts/release-publish.cjs');

const version = '1.0.488';
const target = '9'.repeat(40);
const assets = ['DBYPOS-PATCH-v1.0.488.zip', 'DBYPOS-PATCH-v1.0.488.zip.sha256'].map((name, i) => ({
  name, path: path.join(os.tmpdir(), name), size: 100 + i, digest: `sha256:${String(i).repeat(64)}`,
}));

function gateway(options = {}) {
  const calls = [];
  let exists = !!options.exists;
  let draft = !options.published;
  const uploaded = options.exists ? assets.map((a) => ({ ...a, state: 'uploaded' })) : [];
  const execute = (command, args) => {
    assert.equal(command, 'gh');
    calls.push(args);
    const result = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
    if (args[0] === 'api') {
      if (args[1].includes('/git/ref/')) {
        return options.tagMismatch ? result({ object: {} }) : { status: 1, stderr: 'gh: Not Found (HTTP 404)' };
      }
      if (args[1].includes('/commits/')) return result({ sha: options.tagMismatch && args[1].endsWith(version) ? 'a'.repeat(40) : target });
      if (args[1].endsWith('/releases/123')) {
        const remoteAssets = uploaded.map((a) => ({ ...a }));
        if (options.badDigest) remoteAssets[0].digest = 'sha256:wrong';
        if (options.missingChecksum) remoteAssets.pop();
        return result({ draft, assets: remoteAssets });
      }
    }
    if (args[1] === 'view') {
      if (options.viewError) return { status: 1, stderr: 'HTTP 500: API unavailable' };
      return exists ? result({ databaseId: 123, isDraft: draft }) : { status: 1, stderr: 'release not found' };
    }
    if (args[1] === 'create') {
      assert.ok(args.includes('--draft'));
      assert.equal(args[args.indexOf('--target') + 1], target);
      exists = true;
      return result({});
    }
    if (args[1] === 'upload') {
      assert.ok(draft, 'must never replace assets on a published release');
      assert.ok(args.includes('--clobber'));
      const asset = assets.find((a) => a.path === args[3]);
      if (options.failAsset === asset.name) throw new Error('Network upload failed');
      const index = uploaded.findIndex((a) => a.name === asset.name);
      if (index >= 0) uploaded.splice(index, 1);
      uploaded.push({ ...asset, state: 'uploaded' });
      return result({});
    }
    if (args[1] === 'edit') {
      if (args.includes('--draft=false')) {
        assert.equal(uploaded.length, 2);
        draft = false;
      }
      return result({});
    }
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };
  return { execute, calls };
}

const publish = (mock) => publishRelease({ version, assets, target,
  remote: 'https://github.com/example/desktop.git' }, mock.execute, () => {});
const isPublish = (args) => args.includes('--draft=false');

test('new release stays a draft until both uploaded assets pass digest verification', () => {
  const mock = gateway();
  publish(mock);
  assert.equal(mock.calls.filter((a) => a[1] === 'create').length, 1);
  assert.equal(mock.calls.filter((a) => a[1] === 'upload').length, 2);
  const verification = mock.calls.findIndex((a) => a[1].endsWith('/releases/123'));
  assert.ok(mock.calls.findIndex(isPublish) > verification);
});

test('resume replaces duplicate draft assets without creating another release', () => {
  const mock = gateway({ exists: true });
  publish(mock);
  assert.equal(mock.calls.filter((a) => a[1] === 'create').length, 0);
  assert.equal(mock.calls.filter((a) => a[1] === 'upload').length, 2);
});

for (const failAsset of assets.map((a) => a.name)) {
  test(`upload failure keeps draft unpublished: ${failAsset}`, () => {
    const mock = gateway({ failAsset });
    assert.throws(() => publish(mock), /Network upload failed/);
    assert.ok(!mock.calls.some(isPublish));
  });
}

for (const option of ['badDigest', 'missingChecksum']) {
  test(`remote verification blocks publication: ${option}`, () => {
    const mock = gateway({ [option]: true });
    assert.throws(() => publish(mock), /Remote asset verification failed/);
    assert.ok(!mock.calls.some(isPublish));
  });
}

test('published release is never overwritten', () => {
  const mock = gateway({ exists: true, published: true });
  assert.throws(() => publish(mock), /already published/);
  assert.ok(!mock.calls.some((a) => a[1] === 'upload' || a[1] === 'edit'));
});

test('API errors are not treated as a missing release', () => {
  const mock = gateway({ viewError: true });
  assert.throws(() => publish(mock), /Cannot inspect release/);
  assert.ok(!mock.calls.some((a) => ['create', 'upload', 'edit'].includes(a[1])));
});

test('existing tag pointing elsewhere blocks publication', () => {
  const mock = gateway({ exists: true, tagMismatch: true });
  assert.throws(() => publish(mock), /another commit/);
  assert.ok(!mock.calls.some((a) => a[1] === 'upload'));
});

function artifact(t, { pkgVersion = version, omit } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbyp-release-test-'));
  const zipPath = path.join(dir, `DBYPOS-PATCH-v${version}.zip`);
  t.after(() => {
    fs.unlinkSync(zipPath);
    fs.unlinkSync(`${zipPath}.sha256`);
    fs.rmdirSync(dir);
  });
  const zip = new AdmZip();
  for (const name of ['package.json', 'dist/index.html', 'electron/main.js', 'electron/preload.js',
    'electron/ipc-handlers.js', 'node_modules/ws/index.js',
    'node_modules/@zxing/browser/umd/zxing-browser.min.js', 'node_modules/cloudflared/bin/cloudflared.exe']) {
    if (name !== omit) zip.addFile(`resources/app/${name}`, Buffer.from(name === 'package.json'
      ? JSON.stringify({ version: pkgVersion }) : 'fixture'));
  }
  zip.writeZip(zipPath);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  fs.writeFileSync(`${zipPath}.sha256`, `${digest}  ${path.basename(zipPath)}`);
  return zipPath;
}

test('checks actual archive layout, embedded version, and checksum', (t) => {
  const zipPath = artifact(t);
  const checked = validateArtifact(version, zipPath);
  assert.equal(checked.length, 2);
  assert.match(checked[0].digest, /^sha256:[a-f0-9]{64}$/);
});

test('rejects stale checksum before any upload', (t) => {
  const zipPath = artifact(t);
  fs.appendFileSync(zipPath, 'changed');
  assert.throws(() => validateArtifact(version, zipPath), /do not match/);
});

test('rejects wrong version inside archive', (t) => {
  assert.throws(() => validateArtifact(version, artifact(t, { pkgVersion: '1.0.489' })), /Version inside ZIP/);
});

test('rejects incomplete staged runtime', (t) => {
  assert.throws(() => validateArtifact(version, artifact(t, { omit: 'electron/preload.js' })), /Incomplete ZIP/);
});

test('resume resolves original release commit rather than current branch tip', () => {
  assert.equal(resolveTarget(version, (command, args) => {
    assert.equal(command, 'git');
    return { stdout: args[0] === 'log' ? target : JSON.stringify({ version }) };
  }), target);
});

// Exercise the Windows BAT adapter with fake commands, never real Git/GitHub.
for (const failVerification of [false, true]) {
  test(`BAT resume skips bump/commit/push, verification failure=${failVerification}`, {
    skip: process.platform !== 'win32',
  }, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbyp-bat-test-'));
    fs.mkdirSync(path.join(dir, 'updates'));
    const logFile = path.join(dir, 'commands.txt');
    const files = ['node.cmd', 'npm.cmd', 'git.cmd', 'gh.cmd', 'commands.txt', 'updates/RELEASE-ver3.bat'];
    t.after(() => {
      for (const file of files) {
        const absolute = path.join(dir, file);
        if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
      }
      fs.rmdirSync(path.join(dir, 'updates'));
      fs.rmdirSync(dir);
    });
    fs.writeFileSync(path.join(dir, 'updates/RELEASE-ver3.bat'),
      fs.readFileSync(path.join(__dirname, '../updates/RELEASE-ver3.bat'), 'utf8').replace(/\r?\n/g, '\r\n'));
    for (const command of ['node', 'npm', 'git', 'gh']) {
      fs.writeFileSync(path.join(dir, `${command}.cmd`), [
        '@echo off', `echo ${command} %*>>"%RELEASE_TEST_LOG%"`,
        ...(command === 'node' && failVerification ? ['if "%~2"=="--verify-only" exit /b 1'] : []),
        `exit /b ${['git', 'gh'].includes(command) ? 99 : 0}`, '',
      ].join('\r\n'));
    }
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'updates\\RELEASE-ver3.bat --resume 1.0.488'], {
      cwd: dir, encoding: 'utf8', timeout: 15000, input: '',
      env: { ...process.env, PATH: `${dir};${process.env.PATH}`, RELEASE_TEST_LOG: logFile },
    });
    assert.ifError(result.error);
    assert.equal(result.status, failVerification ? 1 : 0, result.stdout + result.stderr);
    const commands = fs.readFileSync(logFile, 'utf8');
    assert.match(commands, /release-publish\.cjs --verify-only "1\.0\.488"/);
    assert.doesNotMatch(commands, /release-version|^git |^gh /m);
    if (failVerification) assert.doesNotMatch(commands, /npm run build|release-publish\.cjs "1\.0\.488"/);
    else assert.match(commands, /release-publish\.cjs "1\.0\.488"/);
  });
}
