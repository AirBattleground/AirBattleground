"""`adaptive` trainer — always available, CPU, seconds to minutes.

Starting from the base version's bundle it learns:
  1. lexicon    = base.lexicon ∪ every (real) label name. Evaluation during training uses base ∪ TRAIN names
                  only, so TEST numbers are not inflated by TEST labels; the shipped lexicon has all names.
  2. char_fixes = lookalike substitutions mined from the TRAIN confusion report (expected vs OCR char). Each
                  candidate is kept only if it improves TRAIN accuracy (name exact or raw-OCR exact) and does
                  not regress any category (CER, slot, rank, finishes). Greedy forward selection, evaluated
                  with the real pipeline — no simulated gains.
  3. layout     = a small grid search of crop ratios / thresholds on TRAIN (keys present in the pipeline's
                  layout.yaml), same keep-only-if-better rule.
"""

from __future__ import annotations

import copy
import unicodedata
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any

import yaml

from app.bundle import ModelBundle
from app.training.evaluate import evaluate_bundle
from app.training.metrics import EMPTY, aggregate, char_confusions
from app.training.samples import Sample
from app.training.trainers.base import TrainContext, TrainOutcome

LAYOUT_YAML = Path(__file__).resolve().parents[2] / "config" / "layout.yaml"
_HIGHER = (
    "name_exact",
    "ocr_name_exact",
    "slot_accuracy",
    "row_slot_accuracy",
    "rank_accuracy",
    "finishes_accuracy",
)
_LOWER = ("cer", "ocr_cer")
EPS = 1e-9


def _is_letter(c: str) -> bool:
    return unicodedata.category(c).startswith("L")


def rule_context(pred: str, exp: str) -> str:
    if pred.isdigit() and _is_letter(exp):
        return "letters"  # a digit read inside a word that should be a letter (0->O, 1->l)
    if _is_letter(pred) and exp.isdigit():
        return "digits"  # a letter read inside a number (O->0)
    return "any"


def mine_rules(
    scores: list[Any], min_evidence: int, max_rules: int, existing: dict[str, Any]
) -> list[tuple[str, dict[str, Any]]]:
    """Candidate `pred->expected` single-char substitutions from TRAIN confusions, most frequent first."""
    counts: Counter[tuple[str, str]] = Counter()
    for s in scores:
        for n in s.names:
            if n.raw and not n.raw_exact:
                for e, p in char_confusions(n.raw, n.expected):
                    if e != EMPTY and p != EMPTY:
                        counts[(p, e)] += 1
    out: list[tuple[str, dict[str, Any]]] = []
    for (p, e), c in counts.most_common():
        if c < min_evidence or len(out) >= max_rules:
            break
        key = f"{p}->{e}"
        if key in existing:
            continue
        out.append((key, {"context": rule_context(p, e), "evidence": c}))
    return out


def better(new: dict[str, Any], old: dict[str, Any]) -> tuple[bool, list[str]]:
    """(improves, regressions) — improvement on name_exact or ocr_name_exact, with no category regressing."""
    regress = []
    for k in _HIGHER:
        if new.get(k) is not None and old.get(k) is not None and new[k] < old[k] - EPS:
            regress.append(k)
    for k in _LOWER:
        if new.get(k) is not None and old.get(k) is not None and new[k] > old[k] + EPS:
            regress.append(k)
    improved = any(
        new.get(k) is not None and old.get(k) is not None and new[k] > old[k] + EPS
        for k in ("name_exact", "ocr_name_exact")
    ) or (new.get("cer") is not None and old.get("cer") is not None and new["cer"] < old["cer"] - EPS)
    return improved and not regress, regress


def _get(d: dict[str, Any], dotted: str) -> Any:
    cur: Any = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _set(d: dict[str, Any], dotted: str, value: Any) -> dict[str, Any]:
    out = copy.deepcopy(d)
    cur = out
    parts = dotted.split(".")
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value
    return out


# Tunables tried by the layout grid search: dotted key in layout.yaml -> relative/absolute deltas.
# Keys missing from the pipeline's layout.yaml are skipped. Kept small: each value is a full TRAIN eval.
DEFAULT_LAYOUT_SEARCH: dict[str, list[float]] = {
    "preprocess.profiles.dark.ink_min": [-20, 20],  # text ink threshold, dark cards / left panel
    "preprocess.profiles.gold.ink_min": [-20, 20],  # text ink threshold, gold right panel
    "preprocess.scale": [-1.0],  # OCR upscale factor (3.0 -> 2.0)
    "roster.lexicon_accept_score": [-4],  # lexicon snapping strictness
}


def layout_candidates(base_layout: dict[str, Any], search: dict[str, list[float]]) -> list[tuple[str, Any]]:
    try:
        yaml_layout = yaml.safe_load(LAYOUT_YAML.read_text()) if LAYOUT_YAML.exists() else {}
    except Exception:
        yaml_layout = {}
    out: list[tuple[str, Any]] = []
    for key, deltas in search.items():
        cur = _get(base_layout, key)
        if cur is None:
            cur = _get(yaml_layout or {}, key)
        if not isinstance(cur, int | float) or isinstance(cur, bool):
            continue
        for d in deltas:
            v = cur + d
            out.append((key, int(round(v)) if isinstance(cur, int) else round(v, 4)))
    return out


class AdaptiveTrainer:
    name = "adaptive"

    def check(self, samples: list[Sample], options: dict[str, Any]) -> str | None:
        if not samples:
            return "needs at least 1 labelled sample"
        return None

    def train(self, ctx: TrainContext, current: ModelBundle) -> TrainOutcome:
        opts = ctx.options
        min_evidence = int(opts.get("min_rule_evidence", 2))
        max_rules = int(opts.get("max_rule_candidates", 8))
        search = opts.get("layout_search", DEFAULT_LAYOUT_SEARCH)
        notes: list[str] = []
        details: dict[str, Any] = {}

        real_all = [n for s in ctx.train + ctx.test if not s.synthetic for n in s.label_names()]
        real_train = [n for s in ctx.train if not s.synthetic for n in s.label_names()]
        base_lex = set(current.lexicon)
        eval_lex = tuple(sorted(base_lex | set(real_train)))
        final_lex = sorted(base_lex | set(real_all))
        ctx.log(
            f"adaptive: lexicon {len(base_lex)} base + {len(set(real_all) - base_lex)} new names "
            f"(evaluated with TRAIN-only names: {len(eval_lex)})"
        )

        cand = replace(current, lexicon=eval_lex)
        ctx.progress(0.05)
        if not ctx.train:
            ctx.log("adaptive: no TRAIN samples — only the lexicon is updated")
            ctx.draft.write_lexicon(final_lex)
            return TrainOutcome(
                self.name, replace(cand, lexicon=tuple(final_lex)), ["lexicon only (no TRAIN split)"]
            )

        agg, scores = evaluate_bundle(ctx.train, cand, ctx.registry, extract_fn=ctx.extract_fn)
        mixed = any(s.synthetic for s in ctx.train) and any(not s.synthetic for s in ctx.train)
        real_agg = _real(scores) if mixed else None
        details["train_start"] = _brief(agg)
        ctx.log(
            f"adaptive: TRAIN start name_exact={_pct(agg['name_exact'])} ocr={_pct(agg['ocr_name_exact'])} "
            f"cer={_f(agg['cer'])} top confusions={agg['top_confusions'][:6]}"
        )

        # ---- char_fixes: greedy forward selection on TRAIN ----
        fixes = dict(cand.char_fixes)
        rules = mine_rules(scores, min_evidence, max_rules, fixes)
        ctx.log(f"adaptive: {len(rules)} candidate char rules (evidence ≥ {min_evidence})")
        kept, rejected = [], []
        total = len(rules) + len(layout_candidates(cand.layout, search)) or 1
        step = 0
        for key, rule in rules:
            if ctx.cancelled():
                break
            trial = replace(cand, char_fixes={**fixes, key: rule})
            t_agg, t_scores = evaluate_bundle(ctx.train, trial, ctx.registry, extract_fn=ctx.extract_fn)
            ok, regress = better(t_agg, agg)
            if ok and real_agg is not None:  # synthetic evidence must not hurt the real TRAIN images
                regress = [f"real:{k}" for k in better(_real(t_scores), real_agg)[1]]
                ok = not regress
            if ok:
                real_agg = _real(t_scores) if mixed else None
                fixes[key] = {
                    **rule,
                    "train_gain": round((t_agg["name_exact"] or 0) - (agg["name_exact"] or 0), 4),
                }
                cand, agg, scores = replace(cand, char_fixes=fixes), t_agg, t_scores
                kept.append(key)
                ctx.log(
                    f"adaptive: keep {key} ({rule['context']}, evidence {rule['evidence']}) → "
                    f"name_exact {_pct(agg['name_exact'])}, ocr {_pct(agg['ocr_name_exact'])}"
                )
            else:
                rejected.append({"rule": key, "regressions": regress})
                ctx.log(
                    f"adaptive: drop {key}"
                    + (f" (regresses {', '.join(regress)})" if regress else " (no gain)")
                )
            step += 1
            ctx.progress(0.1 + 0.8 * step / total)

        # ---- layout grid search on TRAIN ----
        layout = dict(cand.layout)
        tuned = []
        for key, value in layout_candidates(cand.layout, search):
            if ctx.cancelled():
                break
            trial = replace(cand, layout=_set(layout, key, value))
            t_agg, t_scores = evaluate_bundle(ctx.train, trial, ctx.registry, extract_fn=ctx.extract_fn)
            ok, _ = better(t_agg, agg)
            if ok and real_agg is not None:
                ok = not better(_real(t_scores), real_agg)[1]
            if ok:
                real_agg = _real(t_scores) if mixed else None
                layout = _set(layout, key, value)
                cand, agg, scores = replace(cand, layout=layout), t_agg, t_scores
                tuned.append(f"{key}={value}")
                ctx.log(f"adaptive: layout {key}={value} → name_exact {_pct(agg['name_exact'])}")
            step += 1
            ctx.progress(0.1 + 0.8 * step / total)

        details.update(train_end=_brief(agg), rules_kept=kept, rules_rejected=rejected, layout_tuned=tuned)
        ctx.draft.write_lexicon(final_lex)
        if fixes:
            ctx.draft.write_char_fixes(fixes)
        if layout:
            ctx.draft.write_layout(layout)
        notes.append(
            f"lexicon {len(final_lex)} names; char_fixes kept {kept or 'none'}; layout {tuned or 'unchanged'}"
        )
        ctx.progress(1.0)
        # the evaluated bundle (TRAIN-only lexicon) is scored on TEST; the shipped one has all names
        return TrainOutcome(self.name, cand, notes, details | {"final_lexicon_size": len(final_lex)})


def _real(scores: list[Any]) -> dict[str, Any]:
    return aggregate([s for s in scores if not s.synthetic])


def _brief(agg: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "name_exact",
        "ocr_name_exact",
        "cer",
        "slot_accuracy",
        "rank_accuracy",
        "finishes_accuracy",
        "names",
    )
    return {k: agg.get(k) for k in keys}


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def _f(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.4f}"
