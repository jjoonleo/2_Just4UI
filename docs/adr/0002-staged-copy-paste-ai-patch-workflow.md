# Staged copy/paste AI Patch Workflow

The prototype will implement the multi-step AI flow as a strict copy/paste **AI Patch Workflow** instead of calling Gemini directly or relying only on the existing one-shot request. This keeps the extension focused on user-triggered local extraction, inspectable intermediate artifacts, and deterministic local patch validation while the Page Analysis, Simplification Strategy, and Patch Plan contracts are still evolving.

**Considered Options**

- Keep a single one-shot Gemini request that returns a Patch Plan.
- Call Gemini directly from the extension for every stage.
- Build a staged copy/paste workflow first.

**Consequences**

- The one-shot request remains only as a legacy fallback for comparison.
- The extension must track typed intermediate artifacts so users cannot accidentally apply Page Analysis or Simplification Strategy JSON as a Patch Plan.
- Network permissions, API key storage, rate limits, and direct model error handling are deferred until the staged artifact shapes are stable.
