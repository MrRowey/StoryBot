# Proposed architecture

```text
React child UI / parent dashboard
          |
Node.js API (authentication, settings, jobs)
          |
          +-- Gemini story service + character profiles
          +-- TTS adapters (Gemini / ElevenLabs / local)
          +-- FFmpeg audio processing + duration validation
          +-- Story library (metadata, scripts, MP3s)
          +-- Tonies adapter (discovery, append chapter, sync status)
          |
Persistent volumes for configuration and user data
```

## Integration boundaries

The Tonies integration must run server-side. Start with read-only discovery, then prove an append-only upload against a test Creative-Tonie. Unofficial endpoints and CLI formats can change. Do not treat upload acceptance as proof that the Toniebox has synced.

Use a background job queue for slow AI/TTS/upload operations. Retry idempotently where possible; do not create duplicate chapters on ambiguous failures.

Do not expose the service publicly without proper authentication, HTTPS and rate limiting. Parent configuration should protect provider API keys and Tonies credentials. Store user-created stories locally, not in Git.

The initial repository documentation defines the target design; it does not claim these components are already implemented.
