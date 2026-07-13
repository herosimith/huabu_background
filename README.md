# AdCraft AI MVP Backend

Minimal backend for the Image #1 workflow:

- customer requirement to prompt
- local advertising prompt-library matching plus OpenAI-compatible chat polishing
- original ad image job
- composed environment image job
- vector SVG asset saving
- cookie-based login and role enforcement
- JSON-backed user management, generation credits, and credit ledger

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Before the first authenticated start, configure a strong session secret and the
initial administrator in `.env`:

```dotenv
AUTH_SECRET=<at-least-32-random-bytes>
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=<at-least-10-characters>
ADMIN_BOOTSTRAP_NICKNAME=系统管理员
```

The bootstrap credentials are used only when no administrator exists. After the
administrator is persisted in `data/db.json`, remove
`ADMIN_BOOTSTRAP_PASSWORD` from the runtime environment. Keep `AUTH_SECRET`
stable or all existing sessions will be invalidated after restart.

Without `OPENAI_IMAGE_API_KEY`, image jobs run in mock mode and return generated SVG placeholders.
For `https://apic.aksearch.site/image/` style polling, set `IMAGE_PROVIDER_MODE=async-wrapper`.
`/api/prompt` uses `OPENAI_CHAT_BASE_URL` + `OPENAI_CHAT_MODEL` for prompt polishing and reuses `OPENAI_IMAGE_API_KEY` when `OPENAI_CHAT_API_KEY` is empty.

## Frontend

```bash
npm run dev:web
```

Open `http://127.0.0.1:5173/image/`. The Vite frontend proxies `/api` and
`/storage` to the backend on `http://127.0.0.1:4177`. Set
`VITE_API_TARGET=http://127.0.0.1:<port>` when testing against an isolated API.
The canvas stays at `/image/`; the independent administration console is at
`/image/admin/` and does not embed the canvas.

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
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/prompt`
- `GET /api/prompts/:id`
- `GET /api/prompt-library/images/:filename`
- `POST /api/uploads`
- `GET /api/assets/:id`
- `POST /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/vector-assets`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/users/:id`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/credits`
- `GET /api/credits/summary`
- `GET /api/credits/transactions`
- `POST /api/credits/topup-intents`
- `GET /api/admin/overview`
- `GET /api/admin/credit-rules`
- `PUT /api/admin/credit-rules`
- `GET /api/admin/credit-transactions`
- `GET /api/admin/topup-intents`

All endpoints except health and login require the signed HttpOnly session
cookie. Admin endpoints require the `admin` role. Designers can create and edit
canvas content; reviewers are read-only. Prompt, job, asset, and storage access
is checked against the server-side session owner. Client-supplied `userId`
values are ignored.

## User Management

The user console includes server-side pagination, keyword search, status and
role filters, account creation/editing, soft-disable, credit adjustment, and a
30-entry credit ledger. Passwords use Node's `scrypt`; plaintext passwords and
password hashes are never returned by the API.

The first startup seeds a versioned credit rule from `GENERATION_CREDIT_COST`.
Administrators then publish signup, standard generation, high-quality, and
high-resolution costs from the credit-rule page. Live image jobs use the active
server-side version when queued and refund the same ledger amount if the job
fails. Mock jobs do not consume credits. The JSON store serializes rule
publishing, balance changes, and ledger writes through one update queue so
concurrent operations preserve one active rule and cannot create a negative
balance or lose a transaction.

Users can inspect their current balance and personal ledger from the canvas.
The recharge action is intentionally a reserved interface: it creates a
`pending` top-up intent for administrators to view, but never changes balance
or writes a credit transaction until a payment integration is implemented.

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

## GPT Image 2 output sizes

The web app offers `3840x2160`, `2160x3840`, and `2560x3200` high-resolution presets and sends both `size` and `quality` to the image provider. The API also accepts `auto` and flexible `WIDTHxHEIGHT` values when both edges are multiples of 16, neither edge exceeds 3840, the aspect ratio is at most 3:1, and the total pixel count is between 655,360 and 8,294,400.

Outputs above 2560x1440 total pixels are experimental. Higher resolution can improve legibility but does not guarantee correct Chinese text, so generated copy still requires character-by-character review.

# huabu_background
