/**
 * Measure the screenshot reader on the labelled Training Center samples (admin → Training).
 *
 *   pnpm --filter @7xen/api exec tsx --env-file=.env scripts/eval-reader.ts [--kind RESULTS|SLOT_LIST] [--split TEST|TRAIN|ALL] [--limit 20] [--concurrency 3]
 *
 * Scores (per kind, summed over samples):
 *   SLOT_LIST  slots found (labelled slots the reader returned), names exact (per slot, as a multiset)
 *   RESULTS    ranks found, names exact (per rank), kills exact (for names that matched)
 * Exits non-zero only on setup errors. Prints one line per sample and a summary table.
 */
import { imageInfo, readBuffer } from "../src/lib/storage.js";
import { extractor } from "../src/lib/extractor.js";
import { prisma } from "../src/db.js";

type Kind = "RESULTS" | "SLOT_LIST";
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
};
const kindArg = arg("kind", "ALL");
const split = arg("split", "TEST");
const limit = Number(arg("limit", "1000"));
const concurrency = Number(arg("concurrency", "3"));

interface Score {
  units: number; // slots or ranks labelled
  unitsFound: number;
  names: number;
  namesExact: number;
  namesFolded: number;
  kills: number;
  killsExact: number;
  errors: number;
  samples: number;
}
const zero = (): Score => ({ units: 0, unitsFound: 0, names: 0, namesExact: 0, namesFolded: 0, kills: 0, killsExact: 0, errors: 0, samples: 0 });
const norm = (s: string) => s.normalize("NFC").trim();
/** lookalike-insensitive form: what roster matching effectively needs (0/O, 1/I/l, dots, stars, width, spaces) */
const fold = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[·・•‧∙.]/g, "·")
    .replace(/[¬一ー\-—–]/g, "-")
    .replace(/[Il1|｜]/g, "1")
    .replace(/[Oo0]/g, "0")
    .replace(/[★⋆✩☆✦]/g, "*")
    .replace(/[∆Δ]/g, "Δ")
    .replace(/×/g, "x")
    .replace(/\s+/g, "");

function multisetHits(want: string[], got: string[], f: (s: string) => string = norm): number {
  const pool = new Map<string, number>();
  for (const g of got) pool.set(f(g), (pool.get(f(g)) ?? 0) + 1);
  let hits = 0;
  for (const w of want) {
    const n = pool.get(f(w)) ?? 0;
    if (n > 0) {
      hits++;
      pool.set(f(w), n - 1);
    }
  }
  return hits;
}

async function evalOne(s: { id: string; kind: Kind; storageKey: string; labels: unknown }, score: Score): Promise<string> {
  const buf = await readBuffer(s.storageKey);
  const mime = imageInfo(buf)?.mime ?? "image/jpeg";
  const t0 = Date.now();
  const r = await extractor.extract(buf, mime, s.kind);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const L = s.labels as { teams?: { slot: number; players: string[] }[]; rows?: { rank: number; players: { name: string; kills: number }[] }[] };
  let line = "";
  if (s.kind === "SLOT_LIST") {
    const want = L.teams ?? [];
    let found = 0, names = 0, exact = 0, folded = 0;
    for (const t of want) {
      const g = r.teams.find((x) => x.slot === t.slot);
      if (g) found++;
      names += t.players.length;
      exact += g ? multisetHits(t.players, g.players.map((p) => p.name)) : 0;
      folded += g ? multisetHits(t.players, g.players.map((p) => p.name), fold) : 0;
    }
    score.namesFolded += folded;
    score.units += want.length;
    score.unitsFound += found;
    score.names += names;
    score.namesExact += exact;
    line = `slots ${found}/${want.length} · names ${exact}/${names}`;
  } else {
    const want = L.rows ?? [];
    let found = 0, names = 0, exact = 0, kills = 0, killsOk = 0, folded = 0;
    for (const row of want) {
      const g = r.rows.find((x) => x.rank === row.rank);
      if (g) found++;
      names += row.players.length;
      if (!g) continue;
      folded += multisetHits(row.players.map((p) => p.name), g.players.map((p) => p.name), fold);
      for (const p of row.players) {
        const gp = g.players.find((x) => fold(x.name) === fold(p.name));
        if (gp) {
          if (norm(gp.name) === norm(p.name)) exact++;
          kills++;
          if (gp.kills === p.kills) killsOk++;
        }
      }
    }
    score.units += want.length;
    score.unitsFound += found;
    score.names += names;
    score.namesExact += exact;
    score.namesFolded += folded;
    score.kills += kills;
    score.killsExact += killsOk;
    line = `ranks ${found}/${want.length} · names ${exact}/${names} · kills ${killsOk}/${kills}`;
  }
  return `${s.kind.padEnd(9)} ${s.id}  ${line}  (${secs}s)${r.warnings.length ? `  ⚠ ${r.warnings.join(" | ")}` : ""}`;
}

const kinds: Kind[] = kindArg === "ALL" ? ["SLOT_LIST", "RESULTS"] : [kindArg as Kind];
const samples = await prisma.trainingSample.findMany({
  where: { kind: { in: kinds }, excluded: false, ...(split === "ALL" ? {} : { split: split as "TEST" | "TRAIN" }) },
  orderBy: { createdAt: "asc" },
  take: limit,
  select: { id: true, kind: true, storageKey: true, labels: true },
});
console.log(`Evaluating ${samples.length} samples (${kinds.join(", ")}, split ${split}) with concurrency ${concurrency}…`);
const scores: Record<Kind, Score> = { SLOT_LIST: zero(), RESULTS: zero() };
let next = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < samples.length) {
      const s = samples[next++]! as { id: string; kind: Kind; storageKey: string; labels: unknown };
      scores[s.kind].samples++;
      try {
        console.log(await evalOne(s, scores[s.kind]));
      } catch (e) {
        scores[s.kind].errors++;
        console.log(`${s.kind.padEnd(9)} ${s.id}  ERROR ${(e as Error).message}`);
      }
    }
  }),
);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
console.log("\nSUMMARY");
for (const k of kinds) {
  const s = scores[k];
  if (!s.samples) continue;
  console.log(
    `${k.padEnd(9)} samples ${s.samples} (errors ${s.errors}) · ${k === "RESULTS" ? "ranks" : "slots"} found ${pct(s.unitsFound, s.units)} · names exact ${pct(s.namesExact, s.names)} · names matched ${pct(s.namesFolded, s.names)}${k === "RESULTS" ? ` · kills exact ${pct(s.killsExact, s.kills)}` : ""}`,
  );
}
await prisma.$disconnect();
