"""`paddle_finetune` trainer — PaddleOCR recognition fine-tune, initialised from the base version's rec model.

What PaddleOCR 3.x needs (investigated): the `paddleocr` / `paddlex` pip packages are inference-only; rec
training is PaddleOCR's `tools/train.py` + `ppocr/` from the PaddleOCR git repo (PaddleX's own trainer just
shells out to that same script). So this trainer needs:
  * PADDLEOCR_REPO=/path/to/PaddleOCR checkout (tools/train.py, tools/export_model.py, ppocr/, configs/)
    and its training requirements (`uv sync --extra train` installs them into the venv)
  * initial weights: the base version's `rec_model/train/best_accuracy.pdparams` (a previous fine-tune), else
    the stock pretrained weights PADDLE_REC_PRETRAINED=/path/to/<model>_pretrained.pdparams
    (download URL in the error message; set PADDLE_FINETUNE_ALLOW_DOWNLOAD=1 to let the trainer fetch it)
  * enough name crops (default ≥ 200, env PADDLE_FINETUNE_MIN_NAMES)
Then: crops → dataset (train.txt/val.txt "path\\tlabel") → `tools/train.py` in a subprocess (progress parsed
from the log, log tail streamed) → `tools/export_model.py` into <new version>/rec_model/ (inference model the
pipeline loads) and the training checkpoint into rec_model/train/ (what the *next* fine-tune starts from).

Retrain-on-top: v(N+1) is initialised from v(N)'s checkpoint, never from scratch.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any

import cv2

from app.bundle import ModelBundle
from app.training.crops import name_crops
from app.training.samples import Sample
from app.training.trainers.base import TrainContext, TrainerUnavailable, TrainOutcome

DEFAULT_MIN_NAMES = 200
DEFAULT_REC_MODEL = "PP-OCRv6_small_rec"  # only if app.settings is unavailable; settings.ocr_rec_model wins
PRETRAINED_URL = (
    "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model/{model}_pretrained.pdparams"
)
_EPOCH_RE = re.compile(r"epoch: \[(\d+)/(\d+)\]")


def rec_model_name() -> str:
    try:
        from app.settings import get_settings

        return str(get_settings().ocr_rec_model)
    except Exception:
        return DEFAULT_REC_MODEL


def repo_dir(options: dict[str, Any]) -> Path | None:
    p = options.get("paddleocr_repo") or os.environ.get("PADDLEOCR_REPO")
    return Path(p) if p else None


def find_config(repo: Path, model: str) -> Path | None:
    hits = sorted([*repo.glob(f"configs/rec/**/{model}.yml"), *repo.glob(f"configs/rec/**/{model}.yaml")])
    return hits[0] if hits else None


def count_names(samples: list[Sample]) -> int:
    return sum(len(s.label_names()) for s in samples)


def init_weights(base: ModelBundle, model: str, cache: Path) -> tuple[Path | None, str]:
    """Checkpoint to start from: the base version's fine-tuned weights, else the stock pretrained ones."""
    if base.rec_model_dir:
        ck = base.rec_model_dir / "train" / "best_accuracy.pdparams"
        tag = base.rec_model_dir / "train" / "model_name.txt"
        same_arch = tag.exists() and tag.read_text().strip() == model
        if ck.exists() and same_arch:
            return ck, f"base version {base.version} checkpoint"
    env = os.environ.get("PADDLE_REC_PRETRAINED")
    if env and Path(env).exists():
        return Path(env), "stock pretrained weights (PADDLE_REC_PRETRAINED)"
    cached = cache / f"{model}_pretrained.pdparams"
    if cached.exists():
        return cached, "stock pretrained weights (cache)"
    return None, ""


class PaddleFinetuneTrainer:
    name = "paddle_finetune"

    def check(self, samples: list[Sample], options: dict[str, Any]) -> str | None:
        need = int(
            options.get("finetune_min_names", os.environ.get("PADDLE_FINETUNE_MIN_NAMES", DEFAULT_MIN_NAMES))
        )
        have = count_names([s for s in samples if s.split == "train"])
        problems = []
        if have < need:
            problems.append(f"needs ≥ {need} labelled TRAIN names (have {have})")
        repo = repo_dir(options)
        if repo is None or not (repo / "tools" / "train.py").exists():
            problems.append(
                "needs a PaddleOCR repo checkout: set PADDLEOCR_REPO (git clone "
                "https://github.com/PaddlePaddle/PaddleOCR) and `uv sync --extra train`"
            )
        elif find_config(repo, rec_model_name()) is None:
            problems.append(f"no configs/rec/**/{rec_model_name()}.y(a)ml in {repo}")
        return "; ".join(problems) or None

    def train(self, ctx: TrainContext, current: ModelBundle) -> TrainOutcome:
        reason = self.check(ctx.train + ctx.test, ctx.options)
        if reason:
            raise TrainerUnavailable(f"paddle_finetune unavailable: {reason}")
        repo = repo_dir(ctx.options)
        assert repo is not None
        model = rec_model_name()
        config = find_config(repo, model)
        assert config is not None
        work = ctx.draft.path / "finetune_work"
        ds = work / "dataset"
        (ds / "img").mkdir(parents=True, exist_ok=True)

        # ---- dataset ----
        tr = name_crops(ctx.train, ctx.log)
        te = name_crops(ctx.test, ctx.log) or tr[: max(1, len(tr) // 10)]
        for split, crops in (("train", tr), ("val", te)):
            lines = []
            for i, c in enumerate(crops):
                rel = f"img/{split}_{i:05d}.png"
                cv2.imwrite(str(ds / rel), c.image)
                lines.append(f"{rel}\t{c.label}")
            (ds / f"{split}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        ctx.log(f"paddle_finetune: dataset {len(tr)} train / {len(te)} val name crops in {ds}")
        ctx.progress(0.05)

        # ---- init weights (base checkpoint → stock pretrained) ----
        cache = Path(os.environ.get("PADDLE_PDX_CACHE_HOME", Path.home() / ".paddlex")) / "pretrained"
        weights, src = init_weights(ctx.base, model, cache)
        if weights is None:
            url = PRETRAINED_URL.format(model=model)
            if os.environ.get("PADDLE_FINETUNE_ALLOW_DOWNLOAD") != "1":
                raise TrainerUnavailable(
                    f"paddle_finetune: no initial weights. Download {url} and set PADDLE_REC_PRETRAINED, "
                    "or set PADDLE_FINETUNE_ALLOW_DOWNLOAD=1"
                )
            cache.mkdir(parents=True, exist_ok=True)
            weights = cache / f"{model}_pretrained.pdparams"
            ctx.log(f"paddle_finetune: downloading {url}")
            urllib.request.urlretrieve(url, weights)  # noqa: S310 (fixed https URL)
            src = "stock pretrained weights (downloaded)"
        ctx.log(f"paddle_finetune: initialising from {src}: {weights}")

        # ---- train (subprocess) ----
        out = work / "output"
        epochs = int(ctx.options.get("finetune_epochs", 10))
        bs = min(int(ctx.options.get("finetune_batch", 16)), max(2, len(tr) // 2))
        dict_path = _config_dict(repo, config)
        common = [
            f"Global.character_dict_path={dict_path}",
            "Global.use_gpu=" + ("True" if ctx.options.get("finetune_gpu") else "False"),
            "Global.distributed=False",
        ]
        cmd = [
            sys.executable,
            "tools/train.py",
            "-c",
            str(config),
            "-o",
            f"Global.pretrained_model={str(weights).removesuffix('.pdparams')}",
            f"Global.epoch_num={epochs}",
            f"Global.save_model_dir={out}",
            "Global.print_batch_step=5",
            f"Global.eval_batch_step=[0,{max(1, len(tr) // bs)}]",
            "Global.save_epoch_step=1000",
            f"Train.dataset.data_dir={ds}",
            f"Train.dataset.label_file_list=['{ds / 'train.txt'}']",
            f"Eval.dataset.data_dir={ds}",
            f"Eval.dataset.label_file_list=['{ds / 'val.txt'}']",
            f"Train.loader.batch_size_per_card={bs}",
            f"Train.sampler.first_bs={bs}",
            "Train.loader.num_workers=0",
            "Eval.loader.num_workers=0",
            "Eval.loader.batch_size_per_card=16",
            f"Optimizer.lr.learning_rate={float(ctx.options.get('finetune_lr', 2e-4))}",
            "Optimizer.lr.warmup_epoch=0",
            *common,
        ]
        self._run(cmd, repo, ctx, epochs, lo=0.05, hi=0.85)
        best = out / "best_accuracy.pdparams"
        if not best.exists():
            latest = out / "latest.pdparams"
            if not latest.exists():
                raise RuntimeError("paddle_finetune: training produced no checkpoint (see log)")
            best = latest

        # ---- export inference model into the new version ----
        rec_dir = ctx.draft.rec_model_dir
        if rec_dir.exists():
            shutil.rmtree(rec_dir)  # replace the inherited model
        export = [
            sys.executable,
            "tools/export_model.py",
            "-c",
            str(config),
            "-o",
            f"Global.pretrained_model={str(best).removesuffix('.pdparams')}",
            f"Global.save_inference_dir={rec_dir}",
            *common,
        ]
        self._run(export, repo, ctx, None, lo=0.85, hi=0.95)
        (rec_dir / "train").mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, rec_dir / "train" / "best_accuracy.pdparams")
        shutil.copy2(dict_path, rec_dir / "train" / Path(dict_path).name)
        (rec_dir / "train" / "model_name.txt").write_text(model + "\n")
        # keep the label files + train log; crops are reproducible and checkpoints are large
        shutil.rmtree(ds / "img", ignore_errors=True)
        if (out / "train.log").exists():
            shutil.copy2(out / "train.log", work / "train.log")
        shutil.rmtree(out, ignore_errors=True)
        ctx.progress(1.0)
        bundle = ModelBundle(
            version=current.version,
            path=current.path,
            rec_model_dir=rec_dir,
            lexicon=current.lexicon,
            char_fixes=current.char_fixes,
            layout=current.layout,
        )
        return TrainOutcome(
            self.name,
            bundle,
            [f"rec fine-tuned {epochs} epochs on {len(tr)} crops from {src}"],
            {"train_crops": len(tr), "val_crops": len(te), "init": src, "epochs": epochs},
        )

    def _run(
        self, cmd: list[str], cwd: Path, ctx: TrainContext, epochs: int | None, lo: float, hi: float
    ) -> None:
        ctx.log("$ " + " ".join(cmd[:4]) + " …")
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": str(cwd)}
        with subprocess.Popen(
            cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env
        ) as p:
            assert p.stdout is not None
            for line in p.stdout:
                line = line.rstrip()
                if not line:
                    continue
                if epochs and (m := _EPOCH_RE.search(line)):
                    ctx.progress(lo + (hi - lo) * int(m.group(1)) / max(int(m.group(2)), 1))
                if "epoch:" in line or "best metric" in line or "Error" in line or "error" in line:
                    ctx.log("[paddle] " + line[-300:])
                if ctx.cancelled():
                    p.terminate()
            rc = p.wait()
        if rc != 0:
            raise RuntimeError(f"paddle_finetune: `{cmd[1]}` exited with {rc} (see run log)")


def _config_dict(repo: Path, config: Path) -> str:
    import yaml

    cfg = yaml.safe_load(config.read_text())
    p = str(cfg.get("Global", {}).get("character_dict_path", ""))
    return str(repo / p) if p and not Path(p).is_absolute() else p
