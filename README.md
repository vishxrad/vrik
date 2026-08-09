# वृक (Vrik)

A mobile-first delivery partner interface demo built with Next.js and React.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set `SARVAM_API_KEY` in `.env.local`. The key is only read by the three
server-side route handlers under `/api/local-translation`; it is never sent to
the browser.

## Local translation APIs

- `POST /api/local-translation/transcribe` accepts recorded audio and returns its detected language.
- `POST /api/local-translation/translate` translates Tamil, Hindi, Kannada, or English text.
- `POST /api/local-translation/synthesize` returns the translated message as WAV audio.

The delivery screen chains these routes when the rider uses the floating
Translate button. Recordings and transcripts are processed in memory and are
not stored.

## Validation

```bash
npm run lint
npm test
```

## Deploy to Vercel

Import `vishxrad/vrik` into Vercel. The checked-in `vercel.json` forces the
Next.js framework preset, so Vercel uses `next build` and serves the `.next`
output without an additional output-directory setting. Add `SARVAM_API_KEY` as
a server-side environment variable for Preview and Production deployments.
