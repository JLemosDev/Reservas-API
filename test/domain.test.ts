import assert from "node:assert/strict";
import test from "node:test";
import { intervalsOverlap, parseBookingDraft, parseWindow } from "../src/domain.ts";

test("intervalos encostados não cruzam", () => {
  const hour = 60 * 60 * 1000;
  const ten = Date.parse("2026-11-16T10:00:00.000Z");
  const eleven = ten + hour;
  const twelve = ten + 2 * hour;
  assert.equal(intervalsOverlap(ten, eleven, eleven, twelve), false);
  assert.equal(intervalsOverlap(ten, twelve, eleven, twelve), true);
  assert.equal(intervalsOverlap(eleven, twelve, ten, eleven), false);
});

test("rascunho exige término depois do começo", () => {
  const rejected = parseBookingDraft({
    resourceId: "sala-norte",
    title: "Revisão",
    startsAt: "2026-11-16T11:00:00.000Z",
    endsAt: "2026-11-16T11:00:00.000Z",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.fields.endsAt, /depois/);
});

test("rascunho normaliza o instante", () => {
  const parsed = parseBookingDraft({
    resourceId: " sala-norte ",
    title: "  Revisão ",
    startsAt: "2026-11-16T08:00:00-03:00",
    endsAt: "2026-11-16T09:00:00-03:00",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.resourceId, "sala-norte");
    assert.equal(parsed.value.title, "Revisão");
    assert.equal(parsed.value.startsAt, "2026-11-16T11:00:00.000Z");
  }
});

test("janela sem from falha", () => {
  const window = parseWindow(null, "2026-11-17T00:00:00.000Z");
  assert.equal(window.ok, false);
});
