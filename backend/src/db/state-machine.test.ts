import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canTransition, assertTransition } from "./state-machine";
import type { ApplicationState } from "./types";

describe("canTransition", () => {
  const validPaths: [ApplicationState, ApplicationState][] = [
    ["draft", "ready_for_review"],
    ["ready_for_review", "submitted"],
    ["submitted", "responded"],
    ["submitted", "rejected"],
    ["submitted", "ghosted"],
    ["submitted", "interview"],
  ];

  for (const [from, to] of validPaths) {
    it(`${from} → ${to}`, () => {
      assert.equal(canTransition(from, to), true);
    });
  }

  const invalidPaths: [ApplicationState, ApplicationState][] = [
    ["draft", "submitted"],           // must go through ready_for_review
    ["draft", "rejected"],
    ["ready_for_review", "draft"],    // no backwards transitions
    ["submitted", "draft"],
    ["submitted", "ready_for_review"],
    ["rejected", "submitted"],        // terminal states have no exits
    ["ghosted", "interview"],
    ["interview", "rejected"],
  ];

  for (const [from, to] of invalidPaths) {
    it(`blocks ${from} → ${to}`, () => {
      assert.equal(canTransition(from, to), false);
    });
  }
});

describe("assertTransition", () => {
  it("does not throw on valid transition", () => {
    assert.doesNotThrow(() => assertTransition("draft", "ready_for_review"));
  });

  it("throws on invalid transition", () => {
    assert.throws(
      () => assertTransition("draft", "submitted"),
      /Invalid state transition/
    );
  });

  it("throws on any terminal → non-terminal transition", () => {
    const terminals: ApplicationState[] = ["rejected", "ghosted", "interview", "responded"];
    for (const t of terminals) {
      assert.throws(
        () => assertTransition(t, "submitted"),
        /Invalid state transition/,
        `expected throw for ${t} → submitted`
      );
    }
  });

  it("the human-confirm boundary: only ready_for_review can reach submitted", () => {
    const states: ApplicationState[] = ["draft", "submitted", "responded", "rejected", "ghosted", "interview"];
    for (const s of states) {
      assert.equal(
        canTransition(s, "submitted"),
        false,
        `${s} should not be able to reach submitted directly`
      );
    }
    assert.equal(canTransition("ready_for_review", "submitted"), true);
  });
});
