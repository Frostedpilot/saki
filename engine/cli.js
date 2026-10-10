#!/usr/bin/env node
// cli.js — score a single riichi hand from the command line.
//
// Usage: node cli.js eval <hand>      e.g. node cli.js eval 112233456789m11s
//
// This file used to be a second, standalone implementation of the engine: its
// own KINDS/buildWall/toCounts/shantenOf/hairiOf/toHandStr and a fourth copy of
// the Saki powerDraw hook, none of which the engine used. A hand evaluator is
// genuinely useful on its own, so only `eval` was kept — everything it needs
// already comes from the `riichi` package. For anything involving actual play,
// use `node game.js` (full rules) or run the bridge server.
const Riichi = require('riichi');

function cmdEval(handStr) {
  console.log(`hand: ${handStr}`);
  let r;
  try {
    r = new Riichi(handStr).calc();
  } catch (e) {
    console.error(`could not score '${handStr}': ${e.message}`);
    console.error('expected a riichi-lib hand string, e.g. 112233456789m11s');
    process.exitCode = 1;
    return;
  }
  console.log(`agari=${r.isAgari} han=${r.han} fu=${r.fu} ten=${r.ten} yaku=${JSON.stringify(r.yaku)}`);
  if (r.hairi) console.log(`shanten now=${r.hairi.now}`);
  if (r.text) console.log(r.text);
  if (r.error) console.log('calc error flag');
}

const [, , cmd, a1] = process.argv;
if (cmd === 'eval' && a1) {
  cmdEval(a1);
} else {
  console.log('usage: node cli.js eval <handStr>\n  e.g. node cli.js eval 112233456789m11s');
  console.log('for a full game: node game.js --kyoku 4');
  process.exitCode = 1;
}
