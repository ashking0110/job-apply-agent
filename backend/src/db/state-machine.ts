import { ApplicationState } from "./types";

const VALID_TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  draft: ["ready_for_review"],
  ready_for_review: ["submitted"],
  submitted: ["responded", "rejected", "ghosted", "interview"],
  responded: [],
  rejected: [],
  ghosted: [],
  interview: [],
};

export function canTransition(from: ApplicationState, to: ApplicationState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ApplicationState, to: ApplicationState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} → ${to}`);
  }
}
