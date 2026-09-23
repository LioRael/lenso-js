import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/process-protocol/authoring-v2-conformance.json";
import {
  parseAuthoringFrame,
  validateAuthoringMessage,
  validateInitialize,
  validateInitializeForRuntimeProfile,
  validateInitialized,
  validateEventPublish,
  validateEventPublishResultFor,
  validateInvoke,
  validateOutboundCall,
  validateResultFor,
  validateStreamAction,
  validateStreamOpen,
  validateStreamOpenResultFor,
  validateStreamResultFor,
  type InitializeParams,
  type InvocationScope,
  type SessionIdentity,
} from "@lenso/process-protocol";

describe("Authoring V2 shared values", () => {
  test("validates the cross-language fixture", () => {
    validateInitialize(fixture.initialize);
    validateInitializeForRuntimeProfile(
      fixture.initialize,
      "lenso.process-stdio@2",
    );
    validateInitialized(
      fixture.initialize,
      fixture.initialize as InitializeParams,
    );
    const identity = fixture.initialize.identity as SessionIdentity;
    const parent = fixture.invoke.scope as InvocationScope;
    validateAuthoringMessage(fixture.construct, "construct", identity);
    validateAuthoringMessage(fixture.constructed, "constructed", identity);
    validateAuthoringMessage(fixture.invoke, "invoke", identity);
    validateAuthoringMessage(fixture.result, "result", identity);
    validateAuthoringMessage(
      fixture.outbound_call,
      "outbound_call",
      identity,
      parent,
    );
    validateInvoke(fixture.invoke, fixture.initialize as InitializeParams);
    validateOutboundCall(
      fixture.outbound_call,
      fixture.initialize as InitializeParams,
      parent,
      true,
    );
    expect(() =>
      validateResultFor(
        fixture.result,
        identity,
        fixture.outbound_call.correlation_id,
      ),
    ).toThrow("response identity mismatch");
    validateAuthoringMessage(fixture.cancel, "cancel", identity);
    validateAuthoringMessage(fixture.cancel_ack, "cancel_ack", identity);
    validateAuthoringMessage(fixture.settlement, "settlement", identity);
    validateAuthoringMessage(fixture.stop, "stop", identity);
    validateAuthoringMessage(fixture.stopped, "stopped", identity);
  });

  test("rejects requirement and descriptor mismatches before dispatch", () => {
    const foreign = structuredClone(fixture.initialize);
    foreign.routes[0]!.requirement_id = "missing";
    expect(() => validateInitialize(foreign)).toThrow("unknown requirement_id");
    const wrong = structuredClone(fixture.initialize);
    wrong.routes[0]!.descriptor_version = "2.0.0";
    expect(() => validateInitialize(wrong)).toThrow("does not match");
  });

  test("rejects duplicate, unknown, oversized and noncanonical values", () => {
    expect(() =>
      parseAuthoringFrame('{"api_version":2,"api_version":2}'),
    ).toThrow("strict JSON");
    expect(() => parseAuthoringFrame(`"${"x".repeat(1_048_577)}"`)).toThrow(
      "max_frame_bytes",
    );
    const unknown = { ...fixture.initialize, unknown: true };
    expect(() => validateInitialize(unknown)).toThrow("unknown fields");
    const decimal = structuredClone(fixture.construct);
    decimal.remaining_budget_nanos = "01";
    expect(() =>
      validateAuthoringMessage(
        decimal,
        "construct",
        fixture.initialize.identity as SessionIdentity,
      ),
    ).toThrow("canonical decimal");
  });

  test("keeps runtime failures structured and strict", () => {
    const result = structuredClone(fixture.result) as Record<string, unknown>;
    result.outcome = {
      kind: "runtime",
      failure: {
        kind: "resource_exhausted",
        capability: "example.store@1",
        operation: "get",
      },
    };
    validateResultFor(
      result,
      fixture.initialize.identity as SessionIdentity,
      fixture.invoke.correlation_id,
    );
    const malformed = structuredClone(result) as {
      outcome: { failure: Record<string, unknown> };
    };
    malformed.outcome.failure.detail = "extra";
    expect(() =>
      validateResultFor(
        malformed,
        fixture.initialize.identity as SessionIdentity,
        fixture.invoke.correlation_id,
      ),
    ).toThrow("unknown fields");
  });

  test("requires an exact session and runtime-profile echo", () => {
    const session = structuredClone(fixture.initialize);
    session.identity.session = "session-2";
    expect(() =>
      validateInitialized(session, fixture.initialize as InitializeParams),
    ).toThrow("exactly echo");
    const profile = structuredClone(fixture.initialize);
    profile.identity.runtime_profile = "lenso.bun-authoring@2";
    expect(() =>
      validateInitializeForRuntimeProfile(profile, "lenso.process-stdio@2"),
    ).toThrow("selected Adapter");
    expect(() =>
      validateInitialized(profile, fixture.initialize as InitializeParams),
    ).toThrow("exactly echo");
  });

  test("rejects cross-session and authority-expanding outbound calls", () => {
    const foreign = structuredClone(fixture.invoke);
    foreign.session = "foreign";
    expect(() =>
      validateAuthoringMessage(
        foreign,
        "invoke",
        fixture.initialize.identity as SessionIdentity,
      ),
    ).toThrow("admitted session");
    const expanded = structuredClone(fixture.outbound_call);
    expanded.scope.remaining_budget_nanos = "900001";
    expect(() =>
      validateAuthoringMessage(
        expanded,
        "outbound_call",
        fixture.initialize.identity as SessionIdentity,
        fixture.invoke.scope as InvocationScope,
      ),
    ).toThrow("may not increase");
    expect(() =>
      validateOutboundCall(
        fixture.outbound_call,
        fixture.initialize as InitializeParams,
        fixture.invoke.scope as InvocationScope,
        false,
      ),
    ).toThrow("closed parent");
    const wrongRequirement = structuredClone(fixture.outbound_call);
    wrongRequirement.requirement_id = "secondary_store";
    expect(() =>
      validateOutboundCall(
        wrongRequirement,
        fixture.initialize as InitializeParams,
        fixture.invoke.scope as InvocationScope,
        true,
      ),
    ).toThrow("another requirement");
  });

  test("validates Event admission and ordered Stream session identities", () => {
    const initialize = fixture.initialize as InitializeParams;
    const identity = initialize.identity;
    const common = fixture.invoke;
    const event = {
      ...common,
      operation: "changed",
      event: { key: "a" },
    } as Record<string, unknown>;
    delete event.payload;
    validateEventPublish(event, initialize);
    validateEventPublishResultFor(
      {
        session: identity.session,
        correlation_id: common.correlation_id,
        outcome: { kind: "accepted" },
      },
      identity,
      common.correlation_id,
    );

    const open = {
      ...common,
      correlation_id: "3",
      operation: "watch",
      request: { key: "a" },
    } as Record<string, unknown>;
    delete open.payload;
    validateStreamOpen(open, initialize);
    validateStreamOpenResultFor(
      {
        session: identity.session,
        correlation_id: "3",
        outcome: { kind: "opened", stream_id: "1" },
      },
      identity,
      "3",
    );

    const send = {
      session: identity.session,
      correlation_id: "4",
      stream_id: "1",
      sequence: "0",
      message: { text: "hello" },
    };
    validateStreamAction(send, identity, "stream_send");
    validateStreamResultFor(
      {
        session: identity.session,
        correlation_id: "4",
        stream_id: "1",
        outcome: { kind: "accepted" },
      },
      identity,
      "4",
      "1",
      "stream_action_result",
    );
    expect(() =>
      validateStreamResultFor(
        {
          session: identity.session,
          correlation_id: "5",
          stream_id: "2",
          outcome: { kind: "peer_half_closed" },
        },
        identity,
        "5",
        "1",
        "stream_receive_result",
      ),
    ).toThrow("stream result identity mismatch");
  });
});
