# AdCraft AI MVP Backend

Minimal backend for the Image #1 workflow:

- customer requirement to prompt
- local advertising prompt-library matching plus OpenAI-compatible chat polishing
- original ad image job
- composed environment image job
- vector SVG asset saving

No login, member center, credits, or admin UI.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Without `OPENAI_IMAGE_API_KEY`, image jobs run in mock mode and return generated SVG placeholders.
For `https://apic.aksearch.site/image/` style polling, set `IMAGE_PROVIDER_MODE=async-wrapper`.
`/api/prompt` uses `OPENAI_CHAT_BASE_URL` + `OPENAI_CHAT_MODEL` for prompt polishing and reuses `OPENAI_IMAGE_API_KEY` when `OPENAI_CHAT_API_KEY` is empty.

## Frontend

```bash
npm run dev:web
```

Open `http://127.0.0.1:5173/`. The Vite frontend proxies `/api` and `/storage` to the backend on `http://127.0.0.1:4177`.

Run both from a fresh terminal:

```bash
npm run dev:all
```

## OCR Text Validation And Redraw

The result panel can validate customer-supplied exact text after an image job
finishes. The OCR worker is intentionally local-only and optional: when it is
not running, an image is marked for review rather than being falsely marked as
text-verified.

Start the PaddleOCR sidecar in another terminal:

```bash
npm run dev:ocr
```

The first run downloads Python dependencies and OCR model weights. The sidecar
only binds to `127.0.0.1:4188`. It downsizes OCR input to a maximum edge of
2048, then returns source-pixel coordinates for final-resolution correction.

In the UI, enter one required display string per line before generating. After
the image is complete, use `校验文字`. OCR does not alter the picture. A user
can choose `重绘纠正` or `重绘清晰` to cover a simple text area and render the
exact stored string into a new PNG. The original/composed asset is
retained and the corrected output is saved separately.

## API

- `GET /api/health`
- `POST /api/prompt`
- `GET /api/prompts/:id`
- `GET /api/prompt-library/images/:filename`
- `POST /api/uploads`
- `GET /api/assets/:id`
- `POST /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/vector-assets`

## MVP Flow

1. `POST /api/prompt` with the customer sentence, business type, material, and style. The service matches local references under `assets/prompt-library/`, then asks `gpt-5.5` through an OpenAI-compatible `/v1/chat/completions` endpoint to polish the image prompt. If chat is unavailable, it falls back to the deterministic local template plus the matched references.
2. Create the ad original with `POST /api/jobs`:
   ```json
   {
     "type": "original",
     "promptId": "prompt_xxx",
     "size": "3840x2160",
     "quality": "high"
   }
   ```
3. Upload the customer environment image with `POST /api/uploads`.
4. Create the realistic environment rendering with `POST /api/jobs`:
   ```json
   { "type": "composed", "promptId": "prompt_xxx", "inputAssetIds": ["asset_xxx"] }
   ```
5. Poll `GET /api/jobs/:id` until `status` is `succeeded` or `failed`.
6. Save the vector version with `POST /api/vector-assets` when the frontend/vector worker produces SVG.

The service deliberately excludes login, membership, credits, and admin features for the first MVP.

## GPT Image 2 output sizes

The web app offers `3840x2160`, `2160x3840`, and `2560x3200` high-resolution presets and sends both `size` and `quality` to the image provider. The API also accepts `auto` and flexible `WIDTHxHEIGHT` values when both edges are multiples of 16, neither edge exceeds 3840, the aspect ratio is at most 3:1, and the total pixel count is between 655,360 and 8,294,400.

Outputs above 2560x1440 total pixels are experimental. Higher resolution can improve legibility but does not guarantee correct Chinese text, so generated copy still requires character-by-character review.
