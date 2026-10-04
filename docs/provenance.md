# Vendored assets and their provenance

Three groups of files in this repo are **not built from source that lives here**. This
page records where each came from, what proves it, and — where the answer is unknown —
says so plainly instead of guessing.

Rule followed throughout: **only verifiable facts are asserted.** Where provenance could
not be recovered from the artefacts themselves, this page says "unknown" and gives the
command to re-derive it. Nothing here is inferred from a filename.

---

## 1. `server/public/` — prebuilt WASM client

A compiled client from upstream **`riichi_mahjong_rs`**, committed to git and served as
the server's static site by `server/index.js` (`PUBLIC = path.join(__dirname, 'public')`).

> **There are two clients in this repo, and it is easy to confuse them.**
> `server/public/` is the **prebuilt upstream** client. `web-client/` is the **separate
> Vite + lit-html + TypeScript client** being developed here. They are independent; the
> bridge server serves `server/public/`, and `web-client/` has its own dev server.

### Inventory (as committed)

| File | Bytes | SHA-256 (first 16) |
| --- | ---: | --- |
| `mahjong-client.aa938046.wasm` | 12,388,656 | `7436F3835244AC49` |
| `mq_js_bundle.382096af.js` | 37,407 | `4BF663A44A06C113` |
| `ws.596d430a.js` | 5,268 | `D48FB9FC156C2B8F` |
| `storage.c489e133.js` | 2,257 | `3EC259608ECBD6E2` |
| `loading.32d3b0bf.js` | 656 | `4008A8C2A2A62E63` |
| `index.html` | 4,884 | `1C922606BCCBBC1E` |
| `favicon.png` | 10,608 | `D192385620EBBAD1` |

Re-verify with:

```bash
# from the repo root
node -e "const c=require('node:crypto'),f=require('node:fs');for(const n of f.readdirSync('server/public').sort()){const b=f.readFileSync('server/public/'+n);console.log(n,b.length,c.createHash('sha256').update(b).digest('hex').slice(0,16))}"
```

`index.html` loads exactly four bundles — `mq_js_bundle`, `ws`, `storage`, `loading` —
and references `favicon.png`. The `.wasm` is fetched from the bundle at runtime, not from
a `<script>` tag.

### What is **unknown**

- **The upstream commit.** The filename suffixes (`aa938046`, `382096af`, …) are
  content hashes emitted by the upstream bundler. They are **not** a documented commit
  reference and nothing in the artefacts maps them to one.
- **Any version string.** Verified absent: the bundles contain no version or commit
  literal (searched for `aa938046`, `382096af`, `protocol_version`, `version`), and
  `index.html` is a plain static shell titled `Riichi Mahjong RS`.
- **The upstream licence and redistribution terms** — see [`known-issues.md`](known-issues.md#ki-12).

Because no version marker is embedded, **a protocol upgrade upstream cannot currently be
tracked**. `server/protocol.js` speaks `PROTOCOL_VERSION = 6`; this build's compatibility
with v6 is *believed* (it is what the server is developed against) but is **not proven by
anything in the repo**.

### If you need to update it

There is no scripted path — this was the substance of [KI-08](known-issues.md#ki-08).
Manually: build the client from upstream `riichi_mahjong_rs`, drop the output into
`server/public/`, update the four `<script src>` names in `index.html` to match, then
update the inventory table above with the new sizes and hashes. If you do this, **record
the upstream commit in this file** — that is the whole point of the exercise.

---

## 2. `web-client/src/assets/fluffy-stuff.svg` — tile sheet

**217,893 bytes.** A FluffyStuff riichi tile sheet, hand-converted to an SVG
`<symbol>` sprite: one `<symbol id="tile-…">` per physical tile kind, referenced by the
client's tile renderer.

No provenance metadata survives in the file — it opens directly with
`<svg xmlns="http://www.w3.org/2000/svg" style="display:none">`, with no XML comment,
`dc:rights`, or licence header.

**Unknown:** which upstream revision this was converted from, and under what terms.

---

## 3. `web-client/public/images/sakicardsv13.png` — character card art

**23,088,574 bytes.** Official *Saki* character card art, used for player avatars.

**Unknown:** source and redistribution terms. If this art is not yours to redistribute,
it is the single largest legal exposure in the repo.

---

## 4. npm dependencies (for completeness)

Ordinary declared dependencies with resolvable provenance — see each `package.json` and
the single root `package-lock.json`. These are **not** vendored into the tree:

| Package | Declared in | Version | Role |
| --- | --- | --- | --- |
| `riichi` | `engine`, `server` | `1.2.0` | hand scoring (`engine/scoring.js`, `engine/cli.js`) |
| `syanten` | `engine`, `server`, `web-client` | `1.6.0` | shanten calculation, client-side too |
| `ws` | `server` | `^8.18.0` | WebSocket server for the bridge |
| `lit-html` | `web-client` | `^3.2.1` | client rendering |

Declared as of this writing; `npm ls` is the authority.

The engine's powers (`engine/powers/rosters/*`) are **this repo's own code**, not
third-party, despite the character names.

---

## Summary of what is *not* recorded anywhere in git

1. the upstream commit for `server/public/`
2. the upstream revision for `fluffy-stuff.svg`
3. the source and terms for `sakicardsv13.png`
4. any licence for the repo as a whole

Items 1–3 are recoverable by re-deriving from upstream and re-recording here. Item 4 is a
deliberate open decision — see [KI-12](known-issues.md#ki-12).