# Staged AI Patch Workflow Implementation Plan

## Current State

The extension extracts a user-triggered Page Snapshot, shows the JSON in one popup textarea, builds one legacy Gemini Patch Plan request, and applies pasted Patch Plan JSON to the live tab.

Current implementation anchors:

- `popup.html` owns one visible editor, snapshot controls, one legacy `Build Gemini request` action, and patch actions.
- `popup.js` tracks `latestSnapshot`, `latestSnapshotJson`, and `latestOutputKind`.
- `createGeminiPatchRequest(snapshot)` builds the current one-shot AI Patch Request.
- `applyPatchFromEditor()` parses the editor as a Patch Plan and applies it through local validation and trusted extension code.
- The existing local patch validator/applier remains the only code path that mutates the live page.

## Target v1 Workflow

Implement a strict linear copy/paste AI Patch Workflow:

```text
Extract current page
  -> Build Page Analysis request
  -> Accept pasted Page Analysis
  -> Build Simplification Strategy request
  -> Accept pasted Simplification Strategy
  -> Build Patch Plan request
  -> Apply pasted Patch Plan
```

The extension does not call Gemini directly in v1. It builds prompts, accepts pasted JSON artifacts, and validates enough structure to keep the workflow state unambiguous.

The existing one-shot Gemini request remains as a legacy fallback for comparison during the hackathon.

## UI Changes

Keep one visible textarea/editor. Add workflow-specific actions around it:

- `Build Page Analysis request`
- `Accept Page Analysis`
- `Build Simplification Strategy request`
- `Accept Simplification Strategy`
- `Build Patch Plan request`
- Keep `Apply JSON patch`
- Rename the existing one-shot button to `Legacy one-shot request`

Button enablement should enforce the strict flow:

- `Build Page Analysis request`: enabled when `latestSnapshot` exists.
- `Accept Page Analysis`: enabled after the user pastes JSON into the editor.
- `Build Simplification Strategy request`: enabled when `latestPageAnalysis` exists.
- `Accept Simplification Strategy`: enabled after a strategy request has been built and the user pastes JSON.
- `Build Patch Plan request`: enabled when `latestSnapshot`, `latestPageAnalysis`, and `latestSimplificationStrategy` exist.
- `Apply JSON patch`: keep available for valid Patch Plan JSON, but report a clear error if the editor contains another artifact.

Status messages should tell the user what to paste next.

## Internal State Changes

Add typed state instead of relying only on `latestOutputKind`:

```js
let latestSnapshot = null;
let latestPageAnalysis = null;
let latestSimplificationStrategy = null;
let latestPatchPlan = null;
let latestOutputKind = "snapshot";
```

Suggested output kinds:

- `snapshot`
- `pageAnalysisRequest`
- `pageAnalysis`
- `simplificationStrategyRequest`
- `simplificationStrategy`
- `patchPlanRequest`
- `patchPlan`
- `legacyGeminiRequest`

When a new snapshot is extracted, clear `latestPageAnalysis`, `latestSimplificationStrategy`, and `latestPatchPlan`.

## Request Builders

Add three request builders.

### Page Analysis Request

Input:

- Page Snapshot
- privacy rules
- requirement to return `bridge-page-analysis/0.1`

Output prompt asks Gemini to identify:

- page type
- primary user tasks
- critical content
- preserved interactive nodes
- low-value regions
- risk notes

### Simplification Strategy Request

Input:

- Page Snapshot summary
- Page Analysis
- design goal
- preservation rules

Output prompt asks Gemini to return `bridge-simplification-strategy/0.1` with:

- design goal
- priorities
- selectors to emphasize
- selectors to de-emphasize
- selectors that must not change
- layout directives
- risk notes

### Patch Plan Request

Input:

- Page Analysis
- Simplification Strategy
- compact selector context derived from accepted artifacts
- supported patch operations
- forbidden operations
- response contract

Output prompt asks Gemini to return the existing `bridge-ui-patch-plan/0.1` shape, but the preferred strategy is now a Simplified Shell:

- `create_shell` creates the visible task-first surface.
- `reference_node` creates usable shell actions for original interactive controls without moving them.
- `move_node` moves only non-interactive content into shell slots.
- `collapse_region` keeps lower-priority original regions available without dominating the page.

This is the only AI artifact that can be applied to the live page, and only after local validation.

## Artifact Validators

Add light validators for intermediate artifacts.

### Page Analysis Validation

Require:

- JSON object
- `schemaVersion === "bridge-page-analysis/0.1"`
- `primaryUserTasks`, `criticalContent`, `preservedInteractiveNodes`, `lowValueRegions`, and `riskNotes` are arrays
- selector-bearing entries use non-empty string selectors

### Simplification Strategy Validation

Require:

- JSON object
- `schemaVersion === "bridge-simplification-strategy/0.1"`
- `priorities`, `emphasize`, `deemphasize`, `doNotChange`, `layoutDirectives`, and `riskNotes` are arrays
- selector arrays contain non-empty strings

Intermediate artifacts must never mutate the DOM.

## Patch Plan Integration

Keep `normalizePatchPlan()` and `applyPatchPlanToActiveTab()` as the executable boundary.

Before applying:

- parse editor JSON
- reject Page Analysis and Simplification Strategy artifacts with a clear message
- normalize and validate only `bridge-ui-patch-plan/0.1`
- apply through the existing trusted extension patch path
- restore moved original nodes to their placeholders when resetting the patch

## Manual Verification Checklist

Use a normal `http://` or `https://` page, not a Chrome internal page.

1. Extract a Page Snapshot.
2. Build a Page Analysis request and verify the editor contains a copy/paste prompt.
3. Paste valid Page Analysis JSON and accept it.
4. Build a Simplification Strategy request and verify it includes the Page Analysis.
5. Paste valid Simplification Strategy JSON and accept it.
6. Build a Patch Plan request and verify it includes the analysis, strategy, compact selector context, safety rules, and response contract.
7. Paste a valid shell Patch Plan and apply it.
8. Confirm shell references for original links and safe buttons work as simplified actions, while sensitive or form-like controls reveal/focus the original working controls.
9. Reset the patch and confirm moved nodes return to their original positions.
10. Try pasting the wrong artifact at each step and confirm the extension reports a useful error.

## Deferred Decisions

- Direct Gemini API calls inside the extension.
- API key storage and model configuration.
- AI safety review as a separate model step.
- Patch Repair Request flow from local validation errors.
- Persisting workflow artifacts beyond the current popup session.
- Multi-viewport request generation.
