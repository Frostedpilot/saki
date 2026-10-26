# Vendored assets and their provenance

> **This repository is private.**

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

### Upstream snapshot

Pinned to upstream **`h1g0/riichi_mahjong_rs`** at commit
[`3af1e3bd181b08c1de8edb4a54465c82919f6527`](https://github.com/h1g0/riichi_mahjong_rs/tree/3af1e3bd181b08c1de8edb4a54465c82919f6527)
(2026-09-06, the merge of #388; tree `44f3caae1d4c3f2928caab7ecdfd8d9e3ef852a5`).

The filenames are **not** the evidence; the contents are. At that commit:

| Vendored file | Evidence |
| --- | --- |
| `ws.596d430a.js` | byte-identical to `crates/mahjong-client/js/ws.js`; SHA-1 matches the suffix and the upstream blob (`596d430a…`) |
| `storage.c489e133.js` | same test: `c489e133…` |
| `loading.32d3b0bf.js` | same test: `32d3b0bf…` |
| `favicon.png` | byte-identical to `assets/web/favicon.png` (SHA-1 `09158718…`) |
| `index.html` | byte-identical to `assets/web/index.html` after re-applying the build's content-hash renames, except one line — see below |
| `mq_js_bundle.382096af.js` | generated in the same build run (index.html references its hash); not independently comparable |
| `mahjong-client.aa938046.wasm` | compiled in that same run (index.html references its hash); not independently comparable |

`scripts/vercel-build.sh` at that commit is what assigns the names
(`sha1sum public/<file> | cut -c1-8`), which is why every suffix is reproducible with
`sha1sum` / `Get-FileHash`. The one difference in `index.html` is the deliberate
`window.MAHJONG_SERVER_URL` substitution:

```text
upstream: // window.MAHJONG_SERVER_URL = "wss://example.com/ws";
ours:         window.MAHJONG_SERVER_URL = "ws://127.0.0.1:24141/ws";
```

`24141` is this repo's bridge default (`server/index.js`), so this was a **local build
aimed at this server**, not the published itch.io bundle.

The date closes the window from both sides: `assets/web/index.html` was last changed by
`4e19e27df1` (2026-09-06, merged as `3af1e3bd18`), and these files entered this repo on
2026-09-09. Upstream `main` had no commits between those dates — the next one is
2026-09-14.

### What is proven, and what is not

- **Proven:** the source snapshot is `3af1e3bd18`. Three of the four bundles and the
  favicon are byte-identical to that tree, and `index.html` matches it after the
  documented rename plus the server-URL substitution.
- **Not proven:** a bit-exact rebuild of the `.wasm`. The binary's name is its own SHA-1,
  so it is internally consistent, and `index.html` references its hash in the same run as
  the verified files — but nothing upstream can be compared without compiling. Its
  `producers` custom section records the toolchain: **rustc 1.96.0
  (`ac68faa20` 2026-05-25)**, and embedded paths (`/home/laffey/.cargo/registry/…`) show
  a Linux local build. A rebuild on a different rustc or home directory will produce
  different bytes and therefore different filenames.

### Protocol version

Given the snapshot above, this is now evidence rather than belief. At `3af1e3bd18`
upstream declares `PROTOCOL_VERSION: u32 = 6` in
`crates/mahjong-server/src/protocol/net.rs`, and the client sends that constant in its
`Hello` (`crates/mahjong-client/src/adapter/remote.rs`). `server/protocol.js` also speaks
version 6, so the vendored build matches the bridge it is served from.

### If you need to update it

From the upstream commit, on Linux (WSL works) with the toolchain recorded above:

```bash
git clone https://github.com/h1g0/riichi_mahjong_rs
cd riichi_mahjong_rs
git checkout 3af1e3bd181b08c1de8edb4a54465c82919f6527
rustup toolchain install 1.96.0          # the toolchain recorded in the vendored wasm
rustup override set 1.96.0
rustup target add wasm32-unknown-unknown
MAHJONG_SERVER_URL=ws://127.0.0.1:24141/ws bash scripts/vercel-build.sh
```

Then copy `public/*` into `server/public/`, update the four `<script src>` names and the
wasm loader in `index.html` to the new hashes, and refresh the inventory table above.
**Record the new upstream commit in this file** — that is the whole point of the exercise.
If you build on a different toolchain, expect different content hashes.

---

## 2. `web-client/src/assets/fluffy-stuff.svg` — tile sheet

**217,893 bytes.** A FluffyStuff riichi tile sheet, hand-converted to an SVG
`<symbol>` sprite: one `<symbol id="tile-…">` per physical tile kind, referenced by the
client's tile renderer.

No provenance metadata survives in the file — it opens directly with
`<svg xmlns="http://www.w3.org/2000/svg" style="display:none">`, with no XML comment or
rights metadata.

**Unknown:** which upstream revision this was converted from.

---

## 3. `web-client/public/images/sakicardsv13.png` — character card art

**23,088,574 bytes.** Official *Saki* character card art, used for player avatars.

**Unknown:** source.

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

## 5. Large-binary storage (Git LFS)

The two largest assets above — `mahjong-client.aa938046.wasm` (12.4 MB) and
`sakicardsv13.png` (23 MB) — were committed as ordinary git blobs before
`.gitattributes` existed. That file now routes *future* changes to those paths
(`server/public/*.wasm`, `web-client/public/images/*.png`) through Git LFS, so the
repository stops growing with every art or build refresh.

**History is deliberately not rewritten.** No `git lfs migrate` was run, so existing
clones are unaffected and no force-push was needed; the blobs already in history remain
ordinary objects. The cost is that the ~35 MB is still in history and a fresh clone still
fetches it. Anyone editing one of those two files needs `git-lfs` installed — the CI
checkout passes `lfs: true` for the same reason.

---

## Summary of what is *not* recorded anywhere in git

1. the upstream revision for `fluffy-stuff.svg`
2. the source for `sakicardsv13.png`

The prebuilt WASM client used to be item 1; it is now pinned to
`3af1e3bd18` in §1. Items 1–2 are recoverable by re-deriving from upstream and
re-recording here.
