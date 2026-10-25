'use strict';
// static.test.js — status mapping for the public/ HTTP handler.
//
// The distinction this pins down is the point of KI-09: a missing file is a
// 404, but a file the server *cannot read* (EACCES, EIO) must be a logged 500.
// Collapsing both into 404 is how a permissions problem looks like a broken
// route. The handler also rejected URL/decode edge cases before any read, and
// that is covered here too.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createStaticHandler, MIME } = require('../static');

const ROOT = path.join(__dirname, '..', 'public');

// Minimal response recorder: the handler only calls writeHead/end.
function fakeRes() {
  return {
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers || null;
    },
    end(body) {
      this.body = body;
    },
  };
}

// An injected readFile that fails with a chosen errno.
function failingReader(code) {
  return (filePath, cb) => cb(Object.assign(new Error(`${code}: simulated`), { code }));
}

function request(url, readFile) {
  const res = fakeRes();
  createStaticHandler(ROOT, readFile)({ url }, res);
  return res;
}

// Same, but waits for the real fs callback.
function requestAsync(url) {
  return new Promise((resolve) => {
    const res = fakeRes();
    const end = res.end;
    res.end = (body) => {
      end.call(res, body);
      resolve(res);
    };
    createStaticHandler(ROOT)({ url }, res);
  });
}

test('path-shaped read errors are 404s', () => {
  for (const code of ['ENOENT', 'EISDIR', 'ENOTDIR']) {
    const res = request('/missing.js', failingReader(code));
    assert.equal(res.status, 404, `${code} should be a 404`);
    assert.equal(res.body, 'not found');
  }
});

test('a read failure that is not path-shaped is a logged 500', () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    for (const code of ['EACCES', 'EPERM', 'EIO']) {
      const res = request('/secret.js', failingReader(code));
      assert.equal(res.status, 500, `${code} should be a 500`);
      assert.equal(res.body, 'internal error');
    }
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 3);
  assert.match(logged[0], /static read error:/);
  assert.match(logged[0], /secret\.js/);
  assert.match(logged[0], /EACCES: simulated/);
});

test('a successful read carries the MIME type', () => {
  const reader = (filePath, cb) => cb(null, Buffer.from('<html>'));
  const res = request('/index.html', reader);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], MIME['.html']);
  assert.equal(res.body.toString(), '<html>');

  const unknown = request('/board.bin', reader);
  assert.equal(unknown.headers['Content-Type'], 'application/octet-stream');
});

test('"/" resolves to index.html inside the public root', () => {
  let seen = null;
  const reader = (filePath, cb) => {
    seen = filePath;
    cb(null, Buffer.alloc(0));
  };
  const res = request('/', reader);
  assert.equal(res.status, 200);
  assert.equal(seen, path.join(ROOT, 'index.html'));
});

test('an escaped path is refused before any read', () => {
  let reads = 0;
  const reader = (filePath, cb) => {
    reads++;
    cb(null, Buffer.alloc(0));
  };
  // "/../publicity/x" normalises to a *sibling* of public/, which a plain
  // startsWith(root) prefix check would have accepted.
  for (const url of ['/../publicity/x', '/..%2fpublicity/x', '/../../etc/passwd']) {
    const res = request(url, reader);
    assert.equal(res.status, 403, `${url} should be forbidden`);
    assert.equal(res.body, 'forbidden');
  }
  assert.equal(reads, 0);
});

test('malformed URLs are rejected with 400', () => {
  for (const url of ['/%E0%A4%A', '/%00index.html']) {
    const res = request(url, failingReader('ENOENT'));
    assert.equal(res.status, 400, `${url} should be a 400`);
    assert.equal(res.body, 'bad request');
  }
});

test('a genuinely missing file is a 404 through the real filesystem', async () => {
  const res = await requestAsync('/definitely-not-here.js');
  assert.equal(res.status, 404);
  assert.equal(res.body, 'not found');
});

test('the real index.html is served', async () => {
  const res = await requestAsync('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], MIME['.html']);
  assert.match(res.body.toString(), /<!DOCTYPE html>/);
});
