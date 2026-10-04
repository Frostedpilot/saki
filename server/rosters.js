'use strict';
// rosters.js — the power roster registry.
//
// Roster loading must never take the server down, but a silent catch hid real
// breakage: a typo'd or broken roster made its seat a no-op with no log line.
// Load defensively and say so loudly, once, naming the key that failed.

// Roster loading must never take the server down, but a silent catch hid real
// breakage: a typo'd or broken roster made its seat a no-op with no log line.
// Load defensively and say so loudly, once, naming the key that failed.
const ROSTERS = {};
function loadRoster(key, load) {
  try {
    const hooks = load();
    if (typeof hooks !== 'function') throw new Error('module does not export a hooks factory');
    ROSTERS[key] = hooks;
  } catch (e) {
    console.warn(`[roster] '${key}' failed to load and is unavailable: ${e && e.message ? e.message : e}`);
  }
}
loadRoster('saki', () => require('../engine/powers/rosters/kiyosumi').createSakiHooks);
loadRoster('hisa', () => require('../engine/powers/rosters/hisa').createHisaHooks);
loadRoster('koromo', () => require('../engine/powers/rosters/koromo').createKoromoHooks);
loadRoster('yuuki', () => require('../engine/powers/rosters/yuuki').createYuukiHooks);
loadRoster('mako', () => require('../engine/powers/rosters/mako').createMakoHooks);
loadRoster('nodoka', () => require('../engine/powers/rosters/nodoka').createNodokaHooks);
loadRoster('saki-normal', () => require('../engine/powers/rosters/saki-normal').createSakiNormalHooks);
loadRoster('yuu', () => require('../engine/powers/rosters/achiga').createYuuHooks);

module.exports = { ROSTERS, loadRoster };
