"""Local-only PaddleOCR sidecar for AdCraft text validation.

Run this service on 127.0.0.1 only. It accepts generated image bytes, scales
the image down for CPU-friendly OCR, then maps OCR geometry back to source
pixels so the Node app can render corrections at full resolution.
"""

from __future__ import annotations

import io
import os
from functools import lru_cache
from typing import Any, Dict, List

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image

try:
    from paddleocr import PaddleOCR
except Exception as exc:  # pragma: no cover - exercised in a missing-model environment
    PaddleOCR = None  # type: ignore[assignment]
    PADDLE_IMPORT_ERROR = str(exc)
else:
    PADDLE_IMPORT_ERROR = ""

app = FastAPI(title="AdCraft local OCR sidecar", docs_url=None, redoc_url=None)


@lru_cache(maxsize=1)
def ocr_engine() -> Any:
    if PaddleOCR is None:
        raise RuntimeError(PADDLE_IMPORT_ERROR or "paddleocr is not installed")
    return PaddleOCR(
        lang=os.getenv("PADDLE_OCR_LANG", "ch"),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


def _scale_image(image: Image.Image, max_edge: int) -> tuple[Image.Image, float]:
    width, height = image.size
    scale = min(1.0, max_edge / max(width, height))
    if scale >= 1:
        return image, 1.0
    resized = image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.LANCZOS)
    return resized, scale


def _region(index: int, text: Any, confidence: Any, polygon: Any, scale: float) -> Dict[str, Any] | None:
    text = str(text).strip()
    if not text or not isinstance(polygon, (list, tuple)):
        return None
    points: List[Dict[str, float]] = []
    for point in polygon:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            return None
        points.append({"x": float(point[0]) / scale, "y": float(point[1]) / scale})
    return {
        "id": f"ocr_{index + 1}",
        "text": text,
        "confidence": max(0.0, min(1.0, float(confidence))),
        "polygon": points,
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": PaddleOCR is not None, "error": PADDLE_IMPORT_ERROR or None}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...), max_edge: int = 2048) -> Dict[str, Any]:
    if max_edge < 256 or max_edge > 4096:
        raise HTTPException(status_code=400, detail="max_edge must be between 256 and 4096")
    if PaddleOCR is None:
        raise HTTPException(status_code=503, detail=PADDLE_IMPORT_ERROR or "paddleocr is not installed")
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="image file is required")
    try:
        source = Image.open(io.BytesIO(payload)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"unsupported image: {exc}") from exc

    source_width, source_height = source.size
    image, scale = _scale_image(source, max_edge)
    try:
        result = list(ocr_engine().predict(np.asarray(image)))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PaddleOCR failed: {exc}") from exc

    regions: List[Dict[str, Any]] = []
    for page in result:
        payload = getattr(page, "json", {})
        record = payload.get("res", payload) if isinstance(payload, dict) else {}
        texts = record.get("rec_texts", []) if isinstance(record, dict) else []
        scores = record.get("rec_scores", []) if isinstance(record, dict) else []
        polygons = record.get("rec_polys", []) if isinstance(record, dict) else []
        for index, (text, confidence, polygon) in enumerate(zip(texts, scores, polygons), start=len(regions)):
            region = _region(index, text, confidence, polygon, scale)
            if region:
                regions.append(region)
    return {
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "scale": scale,
        "regions": regions,
    }
