# Provider Boundary

This folder contains plan-creation provider adapters. Provider modules hide request shape, Planning Payload safety checks, credentials, error formatting, and provider-specific response parsing behind one Bridge-facing interface.

Current modules:

- `provider.ts` exposes the Bridge-facing plan-creation boundary used by the service worker.
- `backend-provider.ts` owns Backend Proxy request construction, URL normalization, JSON response extraction, and backend error formatting.
- `../shared/provider-registry.ts` centralizes provider IDs, labels, default model metadata, storage keys, and credential requirements.

Providers return Plan Contract JSON only. They do not own Guidance Session lifecycle, overlay rendering, or page extraction.
