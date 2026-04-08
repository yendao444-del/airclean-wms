const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(process.cwd(), 'package.json');
const command = process.argv[2];

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function parseVersion(version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  return parts;
}

try {
  const pkg = readPackageJson();

  if (command === 'current') {
    process.stdout.write(String(pkg.version));
    process.exit(0);
  }

  if (command === 'next-patch') {
    const parts = parseVersion(pkg.version);
    parts[2] += 1;
    process.stdout.write(parts.join('.'));
    process.exit(0);
  }

  if (command === 'set') {
    const newVersion = process.argv[3];
    parseVersion(newVersion);
    pkg.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    process.stdout.write(newVersion);
    process.exit(0);
  }

  throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
