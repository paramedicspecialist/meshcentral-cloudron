#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');

const certPath = process.env.CERT_LISTENER_CERT || '/run/certs/tls_cert.pem';
const keyPath = process.env.CERT_LISTENER_KEY || '/run/certs/tls_key.pem';
const port = Number(process.env.CERT_LISTENER_PORT || 8443);
const host = process.env.CERT_LISTENER_HOST || '127.0.0.1';

const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
};

const server = https.createServer(options, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
});

server.listen(port, host, () => {
    console.log(`Certificate listener ready on https://${host}:${port}/`);
});

server.on('error', (error) => {
    console.error('Certificate listener error:', error.message);
    process.exit(1);
});
