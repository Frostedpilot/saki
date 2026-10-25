'use strict';
// static.js — HTTP static handler for the vendored riichi_mahjong_rs WASM
// client. It lives apart from index.js so its status mapping can be tested
// without booting the bridge.
//
// The mapping matters: "the file is not there" and "the server cannot read the
// file" used to look identical (both 404). A permissions or IO failure that
// masquerades as a missing route is exactly the silent-failure class KI-09 was
// about, so only path-shaped errors are 404s; anything else is a logged 500.

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

// Read errors that mean "nothing is served at this path" rather than "the
// server cannot read it": a missing file, a directory requested as a file, or
// a path component that is not a directory.
const NOT_FOUND_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR']);

function createStaticHandler(publicDir, readFile = fs.readFile) {
  const root = path.resolve(publicDir);

  return function serveStatic(req, res) {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    // A NUL byte cannot be a path; Node's fs would throw synchronously on it.
    if (urlPath.includes('\0')) {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const filePath = path.normalize(path.join(root, urlPath));
    // path.join normalises '..', so compare the relative path instead of
    // testing a string prefix: startsWith(root) would also accept a sibling
    // such as server/public-old/.
    const rel = path.relative(root, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    readFile(filePath, (err, data) => {
      if (err) {
        if (NOT_FOUND_CODES.has(err.code)) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        console.error('[bridge] static read error:', filePath, err.message);
        res.writeHead(500);
        res.end('internal error');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  };
}

module.exports = { createStaticHandler, MIME };
