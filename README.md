# वृक (Vrik)

Vrik is a voice-first multilingual integration layer for existing quick-commerce
and food-delivery applications operating in linguistically diverse markets such
as India.

It is designed primarily for migrant delivery workers who may have limited
literacy, limited proficiency in the local language, and very little attention
to spare while completing time-sensitive orders. Instead of asking riders to
type, read complicated instructions, select input languages, or navigate support
menus, Vrik is built around one low-cognitive-effort interaction: select who
should understand you, hold a button, and speak naturally.

## The problem

**By the time Ram reaches the door, the shawarma is cold.**

Ram is a Hindi-speaking delivery rider working in Bengaluru. During a single
order, he may need to coordinate with a restaurant worker speaking Urdu, a
security guard speaking Kannada, a customer speaking English, and a support
team organized around language-specific queues.

One simple language barrier creates losses for everyone:

- **The restaurant:** Receives a lower rating because the food arrived cold,
  even though the delay had nothing to do with preparation.
- **The customer:** Paid a premium for convenience but received cold food and
  had to manage calls from the guard, rider, and potentially platform support.
- **The rider:** Is penalized for a late delivery despite doing everything
  possible to complete the order.
- **The platform:** Bears the direct cost of language-specific support teams and
  the indirect cost of an unhappy customer, frustrated rider, and dissatisfied
  restaurant partner.

Nobody did anything wrong. The restaurant made the food. Ram picked it up. The
guard did his job. The customer was available.

The system failed because four people who needed to coordinate could not speak
the same language.

## The solution

Vrik adds a multilingual communication layer directly inside an existing rider
partner application.

For in-person interactions, the rider selects only the output language and
speaks. The system automatically detects the spoken language, transcribes the
message, translates it into natural conversational language, and plays it aloud
for the other person.

```text
Hold to speak
→ Detect language
→ Transcribe
→ Translate
→ Speak aloud
```

This can be used with restaurant staff, security guards, customers, store
employees, and other people encountered during a delivery.

For operational problems, the rider can start a managed voice-support
conversation in their preferred language. The AI agent receives relevant rider
and order context, attempts to resolve routine issues immediately, and escalates
only unresolved cases.

When escalation is necessary, the system creates a structured callback request
containing the rider, order, issue, priority, and AI-generated summary. A human
support representative can then call the rider through a translated,
turn-based conversation where the representative speaks English and the rider
hears Hindi, and vice versa.

## Design principles

Vrik is not intended to become another application that overworked riders must
learn and remember to open. It is designed as an embedded capability for
platforms such as Zomato, Swiggy, Zepto, Blinkit, Rapido, and other logistics or
frontline-work applications.

The interface deliberately minimizes cognitive effort:

- Voice instead of typing
- Automatic input-language detection
- One output-language selection
- Hold-to-speak interaction
- Immediate translated playback
- Order context supplied automatically
- AI resolution before human escalation
- Human support reserved for genuine exceptions

The goal is not merely to translate words. It is to reduce coordination time,
decision fatigue, delivery delays, support costs, rider penalties, and avoidable
marketplace dissatisfaction caused by language diversity.

## Technical implementation

The demo is a mobile-first delivery partner interface built with Next.js and
React. It combines local speech translation, a managed Sarvam voice agent, and
a translated human callback workflow.

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
