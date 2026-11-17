# StoryBot

Self-hosted, child-friendly story creator for Creative-Tonies.

## Project status

Early development. The existing local proof of concept is being migrated into this repository. **No live Tonies uploads or AI narration have been verified in this repository yet.**

## Planned workflow

Choose characters and theme → generate a 5–10 minute story with Gemini → narrate with Gemini TTS, ElevenLabs, or local TTS → optionally mix approved background effects → save the story and MP3 → choose a Creative-Tonie → append a new chapter.

## Principles

- Child-friendly interface; automatic content generation with parent-configured guardrails.
- Stories must be **5–10 minutes** long (check actual audio duration, not just word count).
- Append chapters; never silently replace existing audio.
- Preserve all generated stories in a local library.
- Store reusable character profiles and approved background information.
- Protect credentials and account data; never commit secrets.
- Support Windows development and Docker-based AstraCore deployment.
- Keep a demo mode available while integrating the unofficial Tonies API.

See [the roadmap](docs/ROADMAP.md) and [architecture](docs/ARCHITECTURE.md).

## Security

Never commit `.env`, credentials, access tokens, user-generated stories, or audio. Do not expose Tonies authentication to the browser. Tonies integrations are unofficial and require real-account verification.

## Bricksburg story builder (current)

Requires Node.js 20+. Run `npm test` then `npm start`; open http://localhost:3080.

For live Gemini generation, set `GEMINI_API_KEY` in your **server process environment** (PowerShell: `$env:GEMINI_API_KEY="YOUR_KEY"`) before `npm start`. The example `.env` is a reference only; the application does **not** automatically load dotenv files.

The wizard supports a demo Tonie selection, Bricksburg character roster, Archie always included, up to three child-selected core companions and one to four child-selected guest heroes, one to three villains (including optional AI creation), text or browser-supported speech recognition, Gemini story generation, editable parent review and approval. **Speech recognition may use your browser's speech service; it is not guaranteed to work offline.**

Current limitations: Generated drafts and character selections are **in memory only** and are lost on restart. No login or parent PIN exists yet; keep the server on localhost. Story length is currently an AI word-count target, **not yet verified against finished audio**. No TTS or Tonies upload is enabled. The supplied theme bible was adapted to support configurable core heroes, rather than enforcing the original fixed trio in every story.
