#!/usr/bin/env node

// Install the modules MeshCentral names inside meshcentral.js.
// The Dockerfile does not pin those versions.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const source = process.argv[2] || 'meshcentral.js';
const text = fs.readFileSync(source, 'utf8');
const wanted = ['pg', 'nodemailer', 'ldapauth-fork', 'openid-client', 'passport', 'connect-flash'];
const found = new Map();
const pattern = /['"](@?[a-z0-9._-]+)@(\d+\.\d+\.\d+)['"]/gi;

for (const match of text.matchAll(pattern)) {
    const name = match[1];
    const version = match[2];
    if (!wanted.includes(name)) continue;
    const previous = found.get(name);
    if (previous && previous !== version) {
        console.error(`MeshCentral names ${name}@${previous} and ${name}@${version}`);
        process.exit(1);
    }
    found.set(name, version);
}

const missing = wanted.filter((name) => !found.has(name));
if (missing.length) {
    console.error('MeshCentral did not name a version for: ' + missing.join(', '));
    process.exit(1);
}

const specs = wanted.map((name) => `${name}@${found.get(name)}`);
console.log('Installing ' + specs.join(' '));
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', ...specs], { stdio: 'inherit' });

function installedVersion(name) {
    const pkg = path.join(process.cwd(), 'node_modules', name, 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
}

for (const name of wanted) {
    const actual = installedVersion(name);
    const expected = found.get(name);
    if (actual !== expected) {
        console.error(`${name} installed ${actual}, MeshCentral requires ${expected}`);
        process.exit(1);
    }
    console.log(`${name}@${actual}`);
}
