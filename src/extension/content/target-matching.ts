export interface GuidancePageTarget {
  snapshotId?: string | null;
  selector?: string | null;
  role?: string | null;
  label?: string | null;
  text?: string | null;
  href?: string | null;
  name?: string | null;
  placeholder?: string | null;
}

export interface PageTargetCandidate<TElement> {
  element: TElement;
  snapshotId?: string | null;
  selector?: string | null;
  role?: string | null;
  label?: string | null;
  text?: string | null;
  href?: string | null;
  name?: string | null;
  placeholder?: string | null;
  visible?: boolean;
}

const MINIMUM_SEMANTIC_SCORE = 5;

export function resolvePageTarget<TElement>(
  target: GuidancePageTarget,
  candidates: Iterable<PageTargetCandidate<TElement>>
): TElement | null {
  const visibleCandidates = Array.from(candidates).filter(
    (candidate) => candidate.visible !== false
  );

  const bySnapshotId = findBySnapshotId(target, visibleCandidates);
  if (bySnapshotId) return bySnapshotId.element;

  const bySelector = findBySelector(target, visibleCandidates);
  if (bySelector) return bySelector.element;

  const byEvidence = findBySemanticEvidence(target, visibleCandidates);
  return byEvidence?.element || null;
}

export function scorePageTargetCandidate<TElement>(
  candidate: PageTargetCandidate<TElement>,
  target: GuidancePageTarget
): number {
  let score = 0;
  if (target.role && sameText(candidate.role, target.role)) score += 3;
  if (target.label && includesEither(candidate.label, target.label)) score += 5;
  if (target.text && includesEither(candidate.text, target.text)) score += 5;
  if (target.name && sameText(candidate.name, target.name)) score += 4;
  if (target.placeholder && includesEither(candidate.placeholder, target.placeholder)) {
    score += 4;
  }
  if (target.href && sameHref(candidate.href, target.href)) score += 5;
  return score;
}

function findBySnapshotId<TElement>(
  target: GuidancePageTarget,
  candidates: PageTargetCandidate<TElement>[]
): PageTargetCandidate<TElement> | null {
  const snapshotId = normalizedValue(target.snapshotId);
  if (!snapshotId) return null;
  const candidate = candidates.find(
    (item) => normalizedValue(item.snapshotId) === snapshotId
  );
  if (!candidate) return null;
  return isSnapshotIdEvidenceCompatible(candidate, target) ? candidate : null;
}

function findBySelector<TElement>(
  target: GuidancePageTarget,
  candidates: PageTargetCandidate<TElement>[]
): PageTargetCandidate<TElement> | null {
  const selector = normalizedValue(target.selector);
  if (!selector) return null;
  return (
    candidates.find((candidate) => normalizedValue(candidate.selector) === selector) ||
    null
  );
}

function findBySemanticEvidence<TElement>(
  target: GuidancePageTarget,
  candidates: PageTargetCandidate<TElement>[]
): PageTargetCandidate<TElement> | null {
  let best: PageTargetCandidate<TElement> | null = null;
  let bestScore = MINIMUM_SEMANTIC_SCORE - 1;
  for (const candidate of candidates) {
    const score = scorePageTargetCandidate(candidate, target);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function isSnapshotIdEvidenceCompatible<TElement>(
  candidate: PageTargetCandidate<TElement>,
  target: GuidancePageTarget
): boolean {
  const hasFallbackEvidence = Boolean(
    normalizedValue(target.role) ||
      normalizedValue(target.label) ||
      normalizedValue(target.text) ||
      normalizedValue(target.href) ||
      normalizedValue(target.name) ||
      normalizedValue(target.placeholder)
  );
  if (!hasFallbackEvidence) return true;
  return scorePageTargetCandidate(candidate, target) >= MINIMUM_SEMANTIC_SCORE;
}

function includesEither(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizedValue(left);
  const normalizedRight = normalizedValue(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function sameText(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizedValue(left);
  const normalizedRight = normalizedValue(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function sameHref(left: unknown, right: unknown): boolean {
  const leftText = String(left || "").trim();
  const rightText = String(right || "").trim();
  return Boolean(leftText && rightText && leftText === rightText);
}

function normalizedValue(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
