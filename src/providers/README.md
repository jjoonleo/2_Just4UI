# Provider Boundary

This folder is reserved for plan-creation provider adapters. Provider modules should hide request shape, credentials, error formatting, and model-specific response parsing behind one Bridge-facing interface.

Expected modules:

- `provider.ts` for the shared provider interface.
- `backend-provider.ts` for the Backend Proxy path.
- `gemini-provider.ts` for the Gemini Demo path.
- `openai-provider.ts` for the OpenAI Demo path.

Providers return Plan Contract JSON only. They do not own Guidance Session lifecycle, overlay rendering, or page extraction.
