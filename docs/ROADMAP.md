# StoryBot roadmap

## Agreed requirements
- **5–10 minute** finished audio stories.
- Gemini story generation and reusable character/background profiles.
- Multiple TTS providers: Gemini, ElevenLabs, local engine.
- Optional background music and sound effects from appropriately licensed sources.
- Automatic generation without per-story parental approval, with age-appropriate safeguards, spending/rate limits and parent-managed settings.
- Child chooses the destination Creative-Tonie.
- **Append** new chapters; no destructive replacement by default.
- Persistent local story library including scripts and audio.
- Windows development; Docker/AstraCore production.

## Delivery stages
1. **Foundation** — import the existing tested local POC, modularise the backend, introduce React, docs, environment configuration and basic tests.
2. **Tonies integration** — read-only authentication and Creative-Tonie discovery, then a carefully confirmed test MP3 upload. Validate CLI/API behavior against a real account.
3. **Story generation** — Gemini prompts, character profiles, age-safe validation, 5–10 minute target.
4. **Narration** — configurable TTS provider adapters, voice previews, quotas, actual duration validation.
5. **Sound design** — optional curated music and effects; FFmpeg mixing with clear dialogue.
6. **Story library** — persist scripts, metadata, MP3s, Tonie association, retry and re-upload.
7. **Child UI & automation** — visual selection, progress, background jobs and automatic chapter append.
8. **Parent controls & deployment** — authentication, limits, Docker Compose, backups, health checks and Windows setup.

## Acceptance checks
- No credentials or private stories enter Git history.
- Demo mode works without external accounts.
- Live mode only enables account actions after explicit parent configuration.
- An upload never replaces existing chapters by default.
- Tonie capacity and upload failures are surfaced clearly; generated audio remains saved.
- Narration is 5–10 minutes by measured duration, including any sound design.
