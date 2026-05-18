# Provider Boundary

This folder is reserved for plan-creation provider adapters. Provider modules should hide request shape, Planning Payload safety checks, credentials, error formatting, and model-specific response parsing behind one Bridge-facing interface.

Expected modules:

- `provider-registry.ts` for provider IDs, labels, default model metadata, storage keys, and credential requirements.
- `provider.ts` for the shared provider interface.
- `backend-provider.ts` for the Backend Proxy path.

Providers return Plan Contract JSON only. They do not own Guidance Session lifecycle, overlay rendering, or page extraction.
