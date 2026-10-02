#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'CloudronManifest.json');
const versionsPath = path.join(root, 'CloudronVersions.json');

function readText(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8').trim();
}

function changelogFor(version) {
    const text = readText('CHANGELOG');
    const header = `[${version}]`;
    const start = text.indexOf(header);
    if (start === -1) return `* MeshCentral ${version}`;
    const rest = text.slice(start + header.length).replace(/^\s+/, '');
    const next = rest.search(/\n\[[0-9]+\.[0-9]+\.[0-9]+\]/);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    console.error(`Refusing non-semver package version: ${version}`);
    process.exit(1);
}
const image = process.env.IMAGE || `ghcr.io/paramedicspecialist/meshcentral-cloudron:${version}`;
if (!image.endsWith(`:${version}`)) {
    console.error(`Refusing to catalog ${image} under version ${version}`);
    process.exit(1);
}

if (typeof manifest.description === 'string' && manifest.description.startsWith('file://')) {
    manifest.description = readText(manifest.description.slice('file://'.length));
}
if (typeof manifest.changelog === 'string' && manifest.changelog.startsWith('file://')) {
    manifest.changelog = changelogFor(version);
}
if (typeof manifest.postInstallMessage === 'string' && manifest.postInstallMessage.startsWith('file://')) {
    manifest.postInstallMessage = readText(manifest.postInstallMessage.slice('file://'.length));
}

manifest.dockerImage = image;

let catalog = { stable: true, versions: {} };
if (fs.existsSync(versionsPath)) {
    catalog = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
    catalog.versions = catalog.versions || {};
}

const now = new Date().toUTCString();
const previous = catalog.versions[version];
catalog.stable = true;
catalog.versions[version] = {
    creationDate: previous?.creationDate || now,
    manifest,
    publishState: 'published',
    ts: now
};

fs.writeFileSync(versionsPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Cataloged ${version} as ${image}`);
