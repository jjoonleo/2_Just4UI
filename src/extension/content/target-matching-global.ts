import { resolvePageTarget } from "./target-matching";

const bridgeGlobal = globalThis as typeof globalThis & {
  __bridgeTargetMatching?: {
    resolvePageTarget: typeof resolvePageTarget;
  };
};

bridgeGlobal.__bridgeTargetMatching = {
  resolvePageTarget
};
