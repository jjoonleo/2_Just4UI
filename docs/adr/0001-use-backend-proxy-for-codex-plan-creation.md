# Use Backend Proxy For Codex Plan Creation

Bridge will integrate Codex only as a plan-creation provider behind a backend proxy. The extension sends a Planning Payload and compact continuation context to the proxy, then receives Plan Contract JSON back; Codex OAuth, token handling, endpoint-specific headers, and provider routing stay out of the MV3 extension. This preserves Guide-Only Assistance while avoiding extension-side ChatGPT/Codex token storage, refresh-token ownership conflicts, CORS surprises, and private endpoint drift.
