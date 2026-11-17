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
