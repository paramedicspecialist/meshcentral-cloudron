#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataRoot = '/app/data';
const dataDir = path.join(dataRoot, 'meshcentral-data');
const filesDir = path.join(dataRoot, 'meshcentral-files');
const configPath = path.join(dataDir, 'config.json');

function readJson(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pick(object, keys) {
    if (!object) return undefined;
    for (const key of keys) {
        if (object[key] !== undefined) return object[key];
    }
    return undefined;
}

function randomSessionKey() {
    return crypto.randomBytes(48).toString('hex');
}

function envNumber(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function loadPg() {
    try {
        return require('pg');
    } catch (firstError) {
        try {
            return require('/opt/meshcentral/meshcentral/node_modules/pg');
        } catch (secondError) {
            throw new Error('PostgreSQL is configured, but the pg module is not installed');
        }
    }
}

// MeshCentral 1.2.6 stores every document in Postgres table "main" (db.js).
// A user row is inserted with type "user". A missing table means the first start
// has not created the schema yet, so the count is zero.
async function countPostgresUsers() {
    const { Client } = loadPg();
    const client = new Client({
        host: process.env.CLOUDRON_POSTGRESQL_HOST,
        port: envNumber('CLOUDRON_POSTGRESQL_PORT', 5432),
        user: process.env.CLOUDRON_POSTGRESQL_USERNAME,
        password: process.env.CLOUDRON_POSTGRESQL_PASSWORD,
        database: process.env.CLOUDRON_POSTGRESQL_DATABASE,
        connectionTimeoutMillis: 10000,
        query_timeout: 10000,
        application_name: 'meshcentral-cloudron'
    });

    try {
        await client.connect();
        const result = await client.query(
            'SELECT COUNT(id)::int AS count FROM main WHERE type = $1',
            ['user']
        );
        const count = Number(result.rows[0] && result.rows[0].count);
        if (!Number.isInteger(count) || count < 0) {
            throw new Error('PostgreSQL returned an unexpected user count');
        }
        return count;
    } catch (error) {
        if (error && error.code === '42P01') return 0;
        const detail = error && error.message ? error.message : 'unknown error';
        throw new Error(`Could not count MeshCentral users (${detail}). Startup stopped.`);
    } finally {
        try {
            await client.end();
        } catch (endError) {
            // The count result is already decided. Closing the connection is best-effort.
        }
    }
}

// Local smoke tests have no Postgres. meshcentral.db is the NeDB user database.
// Once that file exists, do not grant site administrator on every later start.
function hasExistingUserDatabase(root) {
    if (!fs.existsSync(root)) return false;
    const pending = [root];
    const userDatabases = new Set(['meshcentral.db', 'meshcentral.sqlite']);
    while (pending.length > 0) {
        const current = pending.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(fullPath);
                continue;
            }
            if ((entry.isFile() || entry.isSymbolicLink()) && userDatabases.has(entry.name)) return true;
        }
    }
    return false;
}

function omitNewAccountRights(entry) {
    if (!entry || typeof entry !== 'object') return;
    delete entry.newAccountsRights;
    delete entry.newaccountsrights;
    const strategies = entry.authstrategies;
    if (!strategies || typeof strategies !== 'object') return;
    for (const strategy of Object.values(strategies)) {
        if (!strategy || typeof strategy !== 'object') continue;
        delete strategy.newAccountsRights;
        delete strategy.newaccountsrights;
    }
}

async function grantFirstCloudronAdmin() {
    if (!process.env.CLOUDRON_OIDC_CLIENT_ID) return false;
    if (process.env.CLOUDRON_POSTGRESQL_HOST) {
        const userCount = await countPostgresUsers();
        return userCount === 0;
    }
    return !hasExistingUserDatabase(dataRoot);
}

async function main() {
    const existing = readJson(configPath);
    const isFirstRun = Object.keys(existing).length === 0;
    const settings = existing.settings || {};
    const domains = existing.domains || {};
    const domain = domains[''] || {};
    const sessionKey = pick(settings, ['sessionKey', 'sessionkey']) || randomSessionKey();
    const existingNewAccounts = pick(domain, ['NewAccounts', 'newaccounts']);
    const managedSettings = new Set([
        'cert', 'port', 'aliasport', 'redirport', 'tlsoffload', 'trustedproxy',
        'wanonly', 'selfupdate', 'webrtc', 'allowframing', 'sessionkey',
        'datapath', 'filespath', 'autobackup', 'plugins', 'mpsport',
        'mpsaliasport', 'postgres', 'mongodb', 'mongodbname'
    ]);
    for (const key of Object.keys(settings)) {
        if (managedSettings.has(key.toLowerCase())) delete settings[key];
    }

    const appDomain = process.env.CLOUDRON_APP_DOMAIN || 'localhost';
    const appOrigin = process.env.CLOUDRON_APP_ORIGIN || `https://${appDomain}`;
    const proxyIp = process.env.CLOUDRON_PROXY_IP || '127.0.0.1';

    const config = {
        $schema: 'https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json',
        settings: {
            ...settings,
            cert: appDomain,
            port: 8080,
            aliasPort: 443,
            redirPort: 0,
            tlsOffload: proxyIp,
            trustedProxy: proxyIp,
            WANonly: true,
            SelfUpdate: false,
            WebRTC: true,
            AllowFraming: false,
            sessionKey,
            datapath: dataDir,
            filespath: filesDir,
            autoBackup: false,
            plugins: { enabled: false },
            mpsPort: 0
        },
        domains: {
            ...domains,
            '': {
                ...domain,
                minify: pick(domain, ['minify']) !== undefined ? pick(domain, ['minify']) : true,
                localSessionRecording: false,
                certUrl: 'https://127.0.0.1:8443/'
            }
        }
    };

    if (existing.smtp) config.smtp = existing.smtp;

    if (process.env.CLOUDRON_POSTGRESQL_HOST) {
        config.settings.postgres = {
            host: process.env.CLOUDRON_POSTGRESQL_HOST,
            port: envNumber('CLOUDRON_POSTGRESQL_PORT', 5432),
            user: process.env.CLOUDRON_POSTGRESQL_USERNAME,
            password: process.env.CLOUDRON_POSTGRESQL_PASSWORD,
            database: process.env.CLOUDRON_POSTGRESQL_DATABASE,
            createdatabase: false
        };
        delete config.settings.mongoDb;
        delete config.settings.mongodb;
    } else {
        delete config.settings.postgres;
    }

    if (process.env.CLOUDRON_MAIL_SMTP_SERVER) {
        config.smtp = {
            host: process.env.CLOUDRON_MAIL_SMTP_SERVER,
            port: envNumber('CLOUDRON_MAIL_SMTP_PORT', 25),
            from: process.env.CLOUDRON_MAIL_FROM,
            user: process.env.CLOUDRON_MAIL_SMTP_USERNAME,
            pass: process.env.CLOUDRON_MAIL_SMTP_PASSWORD,
            tls: false,
            tlscertcheck: false,
            verifyemail: false
        };
    }

    delete config.domains[''].oidc;
    delete config.domains[''].auth;
    delete config.domains[''].authstrategies;
    delete config.domains[''].ldapOptions;
    delete config.domains[''].ldapUserKey;
    delete config.domains[''].ldapUserName;
    delete config.domains[''].ldapUserEmail;
    delete config.domains[''].ldapUserRealName;
    for (const entry of Object.values(config.domains)) omitNewAccountRights(entry);

    const grantFirstAdmin = await grantFirstCloudronAdmin();

    if (process.env.CLOUDRON_OIDC_CLIENT_ID) {
        const issuer = {
            issuer: process.env.CLOUDRON_OIDC_ISSUER
        };
        if (process.env.CLOUDRON_OIDC_AUTH_ENDPOINT) issuer.authorization_endpoint = process.env.CLOUDRON_OIDC_AUTH_ENDPOINT;
        if (process.env.CLOUDRON_OIDC_TOKEN_ENDPOINT) issuer.token_endpoint = process.env.CLOUDRON_OIDC_TOKEN_ENDPOINT;
        if (process.env.CLOUDRON_OIDC_KEYS_ENDPOINT) issuer.jwks_uri = process.env.CLOUDRON_OIDC_KEYS_ENDPOINT;
        if (process.env.CLOUDRON_OIDC_PROFILE_ENDPOINT) issuer.userinfo_endpoint = process.env.CLOUDRON_OIDC_PROFILE_ENDPOINT;

        const oidc = {
            newAccounts: true,
            logouturl: `${appOrigin}/login`,
            client: {
                client_id: process.env.CLOUDRON_OIDC_CLIENT_ID,
                client_secret: process.env.CLOUDRON_OIDC_CLIENT_SECRET,
                redirect_uri: `${appOrigin}/auth-oidc-callback`
            },
            issuer,
            custom: {
                scope: 'openid profile email'
            }
        };
        // MeshCentral honours this on the strategy. It does not make the first
        // OpenID Connect account a site administrator by itself. Drop the key
        // whenever a user already exists so the next start cannot keep granting it.
        if (grantFirstAdmin) oidc.newAccountsRights = ['fulladmin'];
        config.domains[''].authstrategies = { oidc };
        config.domains[''].NewAccounts = existingNewAccounts !== undefined ? existingNewAccounts : false;
    } else if (process.env.CLOUDRON_LDAP_URL) {
        config.domains[''].auth = 'ldap';
        config.domains[''].ldapUserKey = 'entryuuid';
        config.domains[''].ldapUserName = 'username';
        config.domains[''].ldapUserEmail = 'mail';
        config.domains[''].ldapUserRealName = 'displayName';
        config.domains[''].ldapOptions = {
            url: process.env.CLOUDRON_LDAP_URL,
            bindDN: process.env.CLOUDRON_LDAP_BIND_DN,
            bindCredentials: process.env.CLOUDRON_LDAP_BIND_PASSWORD,
            searchBase: process.env.CLOUDRON_LDAP_USERS_BASE_DN,
            searchFilter: '(&(objectclass=user)(|(username={{username}})(mail={{username}})))'
        };
        config.domains[''].NewAccounts = existingNewAccounts !== undefined ? existingNewAccounts : false;
    } else {
        config.domains[''].NewAccounts = existingNewAccounts !== undefined ? existingNewAccounts : true;
    }

    if (process.env.MPS_PORT) {
        config.settings.mpsPort = 4433;
        config.settings.mpsAliasPort = envNumber('MPS_PORT', 4433);
    }

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o640 });
    fs.chmodSync(configPath, 0o640);

    console.log(`Wrote MeshCentral config (${isFirstRun ? 'first run' : 'updated platform fields'}) to ${configPath}`);
    if (process.env.CLOUDRON_OIDC_CLIENT_ID) {
        console.log(grantFirstAdmin
            ? 'No MeshCentral users yet. The first Cloudron sign-in will be the site administrator.'
            : 'MeshCentral already has users. New Cloudron accounts stay normal users.');
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
