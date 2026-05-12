"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { aniEvent } from "./observability";

interface PendingWorkflow {
  id: string;
  title: string;
}

interface PendingWorkflowApi {
  pending: PendingWorkflow | null;
  set: (workflow: PendingWorkflow | null) => void;
  /** Reads + clears in one call — consumer (onNew) gets it once per send. */
  take: () => PendingWorkflow | null;
}

const PendingWorkflowContext = createContext<PendingWorkflowApi | null>(null);

export function PendingWorkflowProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingWorkflow | null>(null);
  const ref = useRef<PendingWorkflow | null>(null);
  useEffect(() => {
    ref.current = pending;
  }, [pending]);

  const set = useCallback((wf: PendingWorkflow | null) => {
    aniEvent(wf ? "pending_workflow.set" : "pending_workflow.clear", {
      "workflow.id": wf?.id ?? null,
    });
    ref.current = wf;
    setPending(wf);
  }, []);

  const take = useCallback(() => {
    const v = ref.current;
    if (v) {
      aniEvent("pending_workflow.consume", { "workflow.id": v.id });
    }
    ref.current = null;
    setPending(null);
    return v;
  }, []);

  const api = useMemo(() => ({ pending, set, take }), [pending, set, take]);
  return <PendingWorkflowContext.Provider value={api}>{children}</PendingWorkflowContext.Provider>;
}

export function usePendingWorkflow(): PendingWorkflowApi {
  const ctx = useContext(PendingWorkflowContext);
  if (!ctx) throw new Error("usePendingWorkflow must be used inside PendingWorkflowProvider");
  return ctx;
}
