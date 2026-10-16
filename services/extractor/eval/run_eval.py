"""Evaluate the extractor on labelled screenshots (CLI + importable).

    uv run python -m eval.run_eval              # real set, active model, roster none+lineup
    uv run python -m eval.run_eval --version v1 --split test
    uv run python -m eval.run_eval --dataset eval/dataset/synthetic # SYNTHETIC — clearly labelled as such
    uv run python -m eval.run_eval --table v0,v1 --report-md eval/REPORT.md   # owner's comparison table

Metrics (see app/training/metrics.py): per-name exact match (effective name = roster/lexicon match or OCR
text, plus raw OCR exact), CER, slot accuracy, rank accuracy, finishes accuracy, top character confusions,
latency p50/p95 — per split (all/train/test) and with/without the labels' `needs_human_check` names.
Writes eval/runs/<timestamp>/report.json + REPORT.md. Real and synthetic datasets are never pooled.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.training.evaluate import ExtractFn, RosterMode, clear_cache, evaluate_bundle  # noqa: E402
from app.training.metrics import ImageScore, aggregate  # noqa: E402
from app.training.registry import FileRegistry  # noqa: E402
from app.training.samples import Sample, load_dataset, roster_from_samples  # noqa: E402

REAL_DIR = SERVICE_DIR / "eval" / "dataset" / "real"
RUNS_DIR = SERVICE_DIR / "eval" / "runs"
SPLITS = ("all", "train", "test")


def _split_scores(scores: list[ImageScore], split: str) -> list[ImageScore]:
    return scores if split == "all" else [s for s in scores if s.split == split]


def summarize(scores: list[ImageScore]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for sp in SPLITS:
        sub = _split_scores(scores, sp)
        if not sub:
            continue
        out[sp] = {"all_names": aggregate(sub), "verified_names": aggregate(sub, exclude_flagged=True)}
    return out


def per_image(scores: list[ImageScore]) -> list[dict[str, Any]]:
    rows = []
    for s in scores:
        agg = aggregate([s])
        rows.append(
            {
                "sample": s.sample_id,
                "kind": s.kind,
                "split": s.split,
                "error": s.error,
                "latency_ms": round(s.latency_ms, 1),
                "name_exact": agg["name_exact"],
                "cer": agg["cer"],
                "slot_accuracy": agg["slot_accuracy"],
                "row_slot_accuracy": agg["row_slot_accuracy"],
                "rank_accuracy": agg["rank_accuracy"],
                "finishes_accuracy": agg["finishes_accuracy"],
                "warnings": s.warnings,
                "wrong_names": [
                    {
                        "expected": n.expected,
                        "predicted": n.predicted,
                        "ocr": n.raw,
                        "confidence": round(n.confidence, 3),
                        "flagged": n.flagged,
                        "kills_expected": n.kills_expected,
                        "kills_predicted": n.kills_predicted,
                    }
                    for n in s.names
                    if not n.exact or n.kills_predicted != n.kills_expected
                ],
                "groups": [asdict(g) for g in s.groups],
            }
        )
    return rows


@dataclass(frozen=True)
class Config:
    label: str
    version: str
    roster: RosterMode = "none"
    raw_ocr: bool = False  # pipeline name postprocessing disabled ("Paddle-only")


@contextlib.contextmanager
def raw_ocr_names() -> Iterator[None]:
    """Disable the pipeline's name postprocessing (NFC/edge-noise cleanup + char_fixes) to measure what
    PaddleOCR itself read. Detection, crops and preprocessing stay identical. Evaluation-only switch."""
    from app.pipeline import postprocess as pp

    saved = (pp.clean_name, pp.apply_char_fixes)
    pp.clean_name = lambda raw, edge_noise, max_len: raw
    pp.apply_char_fixes = lambda s, fixes: s
    clear_cache()
    try:
        yield
    finally:
        pp.clean_name, pp.apply_char_fixes = saved
        clear_cache()


def run_config(
    samples: list[Sample],
    registry: FileRegistry,
    cfg: Config,
    extract_fn: ExtractFn | None = None,
) -> dict[str, Any]:
    bundle = registry.get(cfg.version)
    with raw_ocr_names() if cfg.raw_ocr else contextlib.nullcontext():
        _, scores = evaluate_bundle(
            samples,
            bundle,
            registry,
            roster_mode=cfg.roster,
            scoring_roster=roster_from_samples(samples),
            extract_fn=extract_fn,
        )
    return {
        "version": cfg.version,
        "roster": cfg.roster,
        "raw_ocr": cfg.raw_ocr,
        "summary": summarize(scores),
        "images": per_image(scores),
    }


def evaluate_dataset(
    dataset: Path,
    configs: list[Config],
    registry: FileRegistry,
    split: str = "all",
    extract_fn: ExtractFn | None = None,
) -> dict[str, Any]:
    samples = load_dataset(dataset)
    if split != "all":
        samples = [s for s in samples if s.split == split]
    synthetic = any(s.synthetic for s in samples)
    return {
        "dataset": str(dataset),
        "synthetic": synthetic,
        "images": len(samples),
        "splits": {s.id: s.split for s in samples},
        "flagged_names": sorted(next(iter(samples)).needs_human_check) if samples else [],
        "configs": {c.label: run_config(samples, registry, c, extract_fn) for c in configs},
    }


def table_configs(versions: list[str]) -> list[Config]:
    """Rows of the owner's table: Paddle-only → +postprocess → +learned lexicon/fixes → +roster."""
    base, last = versions[0], versions[-1]
    out = [
        Config("1. Paddle-only", base, "none", raw_ocr=True),
        Config("2. + postprocess", base, "none"),
    ]
    out += [Config(f"3. + learned lexicon/char_fixes ({v})", v, "none") for v in versions[1:]]
    out += (
        [
            Config(f"4. + roster (confirmed lineup), {base}", base, "lineup"),
            Config(f"5. + roster + learned ({last})", last, "lineup"),
        ]
        if len(versions) > 1
        else [Config(f"4. + roster (confirmed lineup), {base}", base, "lineup")]
    )
    return out


# ---------------------------------------------------------------- markdown
def _p(x: float | None) -> str:
    return "–" if x is None else f"{100 * x:.1f}%"


def _c(x: float | None) -> str:
    return "–" if x is None else f"{x:.3f}"


def _ms(x: float | None) -> str:
    return "–" if x is None else f"{x:.0f}"


def metrics_table(rows: list[tuple[str, dict[str, Any]]]) -> list[str]:
    out = [
        "| Config | Names | Name exact | OCR exact | CER | Card slot | Row slot (inferred) | Rank | Finishes "
        "| Missed / extra | p50 / p95 ms |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for label, a in rows:
        out.append(
            f"| {label} | {a['names']} | {_p(a['name_exact'])} | {_p(a['ocr_name_exact'])} "
            f"| {_c(a['cer'])} | "
            f"{_p(a['slot_accuracy'])} ({a['slots']}) | {_p(a['row_slot_accuracy'])} ({a['row_slots']}) | "
            f"{_p(a['rank_accuracy'])} ({a['ranks']}) | "
            f"{_p(a['finishes_accuracy'])} ({a['finishes']}) | {a['missed_names']} / {a['extra_names']} | "
            f"{_ms(a['latency_ms_p50'])} / {_ms(a['latency_ms_p95'])} |"
        )
    return out


def render_md(report: dict[str, Any]) -> str:
    L = [f"# Extractor evaluation — {report['created_at']}", ""]
    for ds in report["datasets"]:
        tag = "**SYNTHETIC — not real-world accuracy**" if ds["synthetic"] else "real screenshots"
        L += [f"## Dataset `{ds['dataset']}` ({tag}, {ds['images']} images)", ""]
        for sp in SPLITS:
            for names_key, title in (
                ("all_names", "all labelled names"),
                ("verified_names", "excluding needs_human_check names"),
            ):
                rows = [
                    (f"{lbl} ({c['version']}, roster={c['roster']})", c["summary"][sp][names_key])
                    for lbl, c in ds["configs"].items()
                    if sp in c["summary"]
                ]
                if rows:
                    L += [f"### split={sp.upper()} — {title}", "", *metrics_table(rows), ""]
        for lbl, c in ds["configs"].items():
            conf = c["summary"].get("all", {}).get("all_names", {}).get("top_confusions", [])
            if conf:
                L += [
                    f"**Top OCR character confusions — {lbl}** (expected→read: count): "
                    + ", ".join(f"`{k}` {v}" for k, v in conf[:12]),
                    "",
                ]
        L += [
            "### Per image (first config)",
            "",
            "| Image | Split | Kind | Name exact | CER | Wrong names (expected → shown) |",
            "|---|---|---|---|---|---|",
        ]
        first = next(iter(ds["configs"].values()))
        for im in first["images"]:
            wrong = "; ".join(f"{w['expected']} → {w['predicted'] or '∅'}" for w in im["wrong_names"][:6])
            more = len(im["wrong_names"]) - 6
            err = " ERROR " + im["error"] if im["error"] else ""
            L.append(
                f"| {im['sample']} | {im['split']} | {im['kind']} | {_p(im['name_exact'])} "
                f"| {_c(im['cer'])} | {wrong}{f' (+{more})' if more > 0 else ''}{err} |"
            )
        L.append("")
    return "\n".join(L)


OWNER_NOTES = """
## Read this first (limitations)

* **Tiny real set.** {n_img} real screenshots from **one** match. The stable sha256 split puts {n_train} in
  TRAIN and **{n_test} ({test_ids}, {test_names} names) in TEST**, so TEST numbers have a huge error bar
  (one name = {pts:.1f} points). The ALL-split rows include images the adaptive trainer learned from — they
  show fit, not generalisation.
* **Names repeat across images.** Every TEST name also appears in a TRAIN lobby screenshot (same match).
  So "+ learned lexicon" on TEST measures the realistic *"lineup already confirmed"* case, not reading
  unseen names. Rows with roster use the confirmed lineup from the slot-list labels.
* **Labels are not all verified.** `needs_human_check` names (ambiguous I/l/1, O/0, unusual Unicode) were
  labelled from the images and await admin confirmation; tables are given with and without them.
* **Synthetic data** (eval/dataset/synthetic, generated by synth/generate.py) is used only as extra TRAIN
  evidence and for pipeline development. Its accuracy is reported separately and is **not** real accuracy.
* **VLM fallback**: not measured — `VLM_ENABLED=false` on this machine (2 GB GPU); the row is n/a.
* **paddle_finetune** was not part of these numbers (needs ≥ 200 real TRAIN name crops; this set has
  {train_names}).
  The trainer was smoke-tested end-to-end on CPU (train → export → chained re-train from the previous
  checkpoint) outside the product registry; those runs produced no run_eval numbers and are not shown.
"""


GPU_HOWTO = """
## How to run `paddle_finetune` (GPU box recommended)

CPU works but is slow (measured here: ~30-45 s per batch of 16 crops on a shared 8-core CPU; 2 epochs on
147 crops ≈ 20 min). On a CUDA box:

```bash
cd services/extractor
uv sync --extra train                       # PaddleOCR training deps (scikit-image, albumentations, ...)
uv pip install paddlepaddle-gpu==<match your CUDA>   # replaces CPU paddle in the venv
git clone --depth 1 --filter=blob:none --sparse https://github.com/PaddlePaddle/PaddleOCR /opt/PaddleOCR
git -C /opt/PaddleOCR sparse-checkout set tools ppocr configs/rec
export PADDLEOCR_REPO=/opt/PaddleOCR
# stock weights for the model the pipeline uses (settings.ocr_rec_model, e.g. PP-OCRv6_small_rec):
curl -LO https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/PP-OCRv6_small_rec_pretrained.pdparams
export PADDLE_REC_PRETRAINED=$PWD/PP-OCRv6_small_rec_pretrained.pdparams
uv run python -m app.training.cli --dataset eval/dataset/real --trainer paddle_finetune --epochs 20
```

Then copy `models/vN/` to the production MODELS_DIR (or run the extractor there with `POST /v1/training/runs`
and `PADDLE_FINETUNE_GPU=1`), compare metrics in `GET /v1/models`, and activate. A later fine-tune starts
from `models/vN/rec_model/train/best_accuracy.pdparams` (same architecture only), never from scratch.
"""


def _brief(d: dict[str, Any] | None) -> str:
    if not d:
        return "n/a"
    keys = ("name_exact", "ocr_name_exact", "cer", "finishes_accuracy")
    return (
        ", ".join(f"{k} {_c(d.get(k)) if k == 'cer' else _p(d.get(k))}" for k in keys)
        + f" ({d.get('names')} names)"
    )


def owner_md(report: dict[str, Any], registry: FileRegistry, versions: list[str]) -> str:
    L = [
        "# 7xen extractor — accuracy report",
        "",
        f"Generated {report['created_at']} by `uv run python -m eval.run_eval --table {','.join(versions)} "
        "--dataset eval/dataset/real --dataset eval/dataset/synthetic --report-md eval/REPORT.md`. "
        "All numbers below are produced by eval/run_eval.py (raw JSON next to the run in eval/runs/).",
    ]
    real = [d for d in report["datasets"] if not d["synthetic"]]
    if real:
        d0, c0 = real[0], next(iter(real[0]["configs"].values()))["summary"]
        test_ids = [k for k, v in d0["splits"].items() if v == "test"]
        tn = c0.get("test", {}).get("all_names", {}).get("names", 0)
        L.append(
            OWNER_NOTES.format(
                n_img=d0["images"],
                n_train=len(d0["splits"]) - len(test_ids),
                n_test=len(test_ids),
                test_ids=", ".join(test_ids),
                test_names=tn,
                pts=100 / max(tn, 1),
                train_names=c0.get("train", {}).get("all_names", {}).get("names", 0),
            )
        )
    synth = [d for d in report["datasets"] if d["synthetic"]]
    for ds in real:
        L += [f"## Real screenshots ({ds['images']} images)", ""]
        for sp, title in (("all", "ALL 7 images (includes TRAIN)"), ("test", "TEST split only (1 image)")):
            for key, sub_t in (
                ("all_names", "all labelled names"),
                ("verified_names", "excluding needs_human_check"),
            ):
                rows = [
                    (lbl, c["summary"][sp][key]) for lbl, c in ds["configs"].items() if sp in c["summary"]
                ]
                if rows:
                    L += [f"### {title} — {sub_t}", "", *metrics_table(rows)]
                    L += ["| 6. + VLM fallback | n/a — VLM disabled on this machine | | | | | | | | | |", ""]
        best = list(ds["configs"].items())[-1]
        L += [f"### Remaining errors — {best[0]} (ALL images)", ""]
        n_err = len(L)
        for im in best[1]["images"]:
            for w in im["wrong_names"]:
                if w["expected"] != w["predicted"]:
                    flag = " (needs_human_check)" if w["flagged"] else ""
                    L.append(f"* {im['sample']}: `{w['expected']}` → `{w['predicted'] or '∅'}`{flag}")
        if len(L) == n_err:
            L.append("none")
        conf = list(ds["configs"].values())[1]["summary"]["all"]["all_names"]["top_confusions"]
        L += [
            "",
            "Top raw OCR confusions (expected→read: count), stock model: "
            + ", ".join(f"`{k}` {v}" for k, v in conf[:12]),
            "",
        ]
    L += [
        "## Training runs (TEST metrics measured by the run itself)",
        "",
        "Measured when the version was trained, with the pipeline code of that moment; the pipeline keeps",
        "changing, so a run's *before* number can differ from row 2 above (which is re-measured now).",
        "",
    ]
    for v in versions[1:]:
        m = registry.manifest(v)
        b, a = m.get("metrics_before") or {}, m.get("metrics") or {}
        det = (m.get("details") or {}).get("adaptive", {})
        L += [
            f"### {v} (parent {m.get('parent')}, trainer {m.get('trainer')}, "
            f"{m.get('sample_count')} samples)",
            "",
            f"* TEST name exact {_p(b.get('name_exact'))} → {_p(a.get('name_exact'))}; "
            f"CER {_c(b.get('cer'))} → {_c(a.get('cer'))} "
            f"({a.get('names')} names, {a.get('images')} image(s))",
            f"* TRAIN (real + synthetic) during training: {_brief(det.get('train_start'))} → "
            f"{_brief(det.get('train_end'))}",
            f"* char_fixes kept: {det.get('rules_kept')}; rejected: {det.get('rules_rejected')}",
            f"* layout tuned: {det.get('layout_tuned') or 'none'}; shipped lexicon: "
            f"{det.get('final_lexicon_size')} names",
            f"* notes: {m.get('notes')}",
            "",
        ]
    for ds in synth:
        L += [f"## SYNTHETIC screenshots ({ds['images']} images) — NOT real-world accuracy", ""]
        rows = [(lbl, c["summary"]["all"]["all_names"]) for lbl, c in ds["configs"].items()]
        L += [*metrics_table(rows), ""]
        L += [
            "Synthetic names are random and never in the learned lexicon, so row 3 vs row 2 here shows the",
            "lexicon's effect on *unseen* names (any drop = false snaps to known names); rows 4-5 show the",
            "roster effect when the lineup is known.",
            "",
        ]
    L.append(GPU_HOWTO)
    return "\n".join(L) + "\n"


def write_report(report: dict[str, Any], out_dir: Path) -> Path:
    run = out_dir / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    run.mkdir(parents=True, exist_ok=True)
    (run / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8"
    )
    (run / "REPORT.md").write_text(render_md(report), encoding="utf-8")
    return run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, action="append", help="dataset dir with labels.json (repeatable)")
    ap.add_argument("--version", help="model version (default: active)")
    ap.add_argument(
        "--roster",
        choices=["none", "lineup", "both"],
        default="both",
        help="send the confirmed lineup (from SLOT_LIST labels) as the roster",
    )
    ap.add_argument("--split", choices=SPLITS, default="all")
    ap.add_argument("--table", help="comma list of versions for the comparison table, e.g. v0,v1")
    ap.add_argument("--models-dir", type=Path)
    ap.add_argument("--out", type=Path, default=RUNS_DIR)
    ap.add_argument(
        "--report-md", type=Path, help="with --table: also write the owner report (e.g. eval/REPORT.md)"
    )
    a = ap.parse_args(argv)
    if a.models_dir:
        os.environ["MODELS_DIR"] = str(a.models_dir)
    registry = FileRegistry()
    datasets = a.dataset or [REAL_DIR]
    configs = table_configs([v.strip() for v in a.table.split(",")]) if a.table else []
    if not a.table:
        v = a.version or registry.active_version()
        modes: list[RosterMode] = ["none", "lineup"] if a.roster == "both" else [a.roster]
        configs = [Config(f"{v} roster={m}", v, m) for m in modes]
    report = {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "models_dir": str(registry.root),
        "vlm_enabled": os.environ.get("VLM_ENABLED", "false").lower() == "true",
        "datasets": [evaluate_dataset(d, configs, registry, a.split) for d in datasets],
    }
    run = write_report(report, a.out)
    if a.report_md and a.table:
        a.report_md.write_text(
            owner_md(report, registry, [v.strip() for v in a.table.split(",")]), encoding="utf-8"
        )
        print(f"wrote {a.report_md}")
    print((run / "REPORT.md").read_text(encoding="utf-8"))
    print(f"\nwrote {run}/report.json and REPORT.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
