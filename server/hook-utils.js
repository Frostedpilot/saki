'use strict';
// A character hook that throws must not break the match, but it must not be
// silent either: a power that is quietly inert looks identical to a power that
// simply has no effect this hand. Warn once per call site so a per-tick hook
// cannot flood the log.
const warnedSites = new Set();

function warnOnce(site, e) {
  if (warnedSites.has(site)) return;
  warnedSites.add(site);
  const msg = e && e.message ? e.message : String(e);
  console.warn(`[power] '${site}' threw and was ignored: ${msg}`);
}

// Invoke a character hook defensively. A bug in a power must not break the
// match — but it must not be silent, and (because the hand driver is one big
// async chain) an unguarded throw also rejected run() and bricked the room.
// Every hook call goes through here so there is exactly one policy.
function callHook(hooks, name, ...args) {
  if (!hooks || typeof hooks[name] !== 'function') return null;
  try {
    return hooks[name].call(hooks, ...args);
  } catch (e) {
    warnOnce(name, e);
    return null;
  }
}

module.exports = { warnOnce, callHook };
