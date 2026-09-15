const { execFileSync } = require('child_process');

const tier = String(process.argv[2] || '').trim().toLowerCase();
const validTiers = new Set(['renderer', 'quick', 'prisma', 'prisma-python', 'full']);

if (!validTiers.has(tier)) {
  console.error('RELEASE_PREFLIGHT_FAILED Unknown release tier.');
  process.exit(1);
}

function gitLines(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    console.error(`RELEASE_PREFLIGHT_FAILED Cannot inspect git changes: ${error.message}`);
    process.exit(1);
  }
}

let releaseBaseline = null;
try {
  releaseBaseline = execFileSync(
    'git',
    ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
} catch {
  try {
    releaseBaseline = execFileSync(
      'git',
      ['log', '-1', '--format=%H', '--grep=^v[0-9]'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    // A repository without release history is validated from its working tree only.
  }
}

const changedFiles = new Set([
  ...(releaseBaseline ? gitLines(['diff', '--name-only', `${releaseBaseline}..HEAD`]) : []),
  ...gitLines(['diff', '--name-only', 'HEAD']),
  ...gitLines(['diff', '--name-only', '--cached']),
  ...gitLines(['ls-files', '--others', '--exclude-standard']),
]);

const normalized = [...changedFiles].map((file) => file.replace(/\\/g, '/'));
const ignoredPrefixes = [
  'dist/',
  'release4/',
  'release-installer/',
  'tmp/',
  'output/',
  'qa/',
];
const relevant = normalized.filter(
  (file) => !ignoredPrefixes.some((prefix) => file.startsWith(prefix)),
);

const isPrismaImpact = (file) =>
  file === 'prisma/schema.prisma' ||
  file.startsWith('prisma/migrations/') ||
  file === 'package.json' ||
  file === 'package-lock.json';
const isPythonImpact = (file) => file.startsWith('python/') && !file.toLowerCase().endsWith('.md');
const isBackendImpact = (file) => file.startsWith('electron/');
const isReleaseTooling = (file) =>
  /^(?:updates\/)?RELEASE(?:-[^/]+)?\.bat$/i.test(file) ||
  file === 'BUILD-INSTALLER.bat' ||
  file === 'updates/BUILD-INSTALLER.bat' ||
  file === 'AGENTS.md' ||
  file === 'updates/QUY_TAC_PHAT_HANH.md' ||
  file === 'updates/SECURITY-DEPLOYMENT.md' ||
  file === 'updates/README.md' ||
  file.startsWith('scripts/release-') ||
  file === 'scripts/patch-runtime-smoke.cjs';

const blockers = [];
if (tier === 'renderer') {
  blockers.push(
    ...relevant.filter(
      (file) =>
        isBackendImpact(file) ||
        isPrismaImpact(file) ||
        isPythonImpact(file) ||
        isReleaseTooling(file),
    ),
  );
}
if (tier === 'quick') {
  blockers.push(...relevant.filter((file) => isPrismaImpact(file) || isPythonImpact(file)));
}
if (tier === 'prisma') {
  blockers.push(...relevant.filter(isPythonImpact));
}

console.log(`Release tier: ${tier}`);
console.log(`Compared from release baseline: ${releaseBaseline || '(no release baseline found)'}`);
console.log(`Changed files inspected: ${relevant.length}`);
if (relevant.length > 0) {
  relevant.slice(0, 40).forEach((file) => console.log(`  - ${file}`));
  if (relevant.length > 40) console.log(`  - ... and ${relevant.length - 40} more`);
}

if (blockers.length > 0) {
  console.error('');
  console.error('RELEASE_PREFLIGHT_FAILED This release tier is too small for the current changes:');
  [...new Set(blockers)].forEach((file) => console.error(`  - ${file}`));
  console.error('Read updates/QUY_TAC_PHAT_HANH.md and select a higher release tier.');
  process.exit(1);
}

if (relevant.some((file) => file === 'package.json' || file === 'package-lock.json')) {
  console.warn('WARNING: package files changed. Confirm that no new runtime/native dependency requires a full installer.');
}

console.log('RELEASE_PREFLIGHT_OK');
