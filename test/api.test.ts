import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { start } from "../src/server.ts";

const DAY = {
  from: "2026-11-16T00:00:00.000Z",
  to: "2026-11-17T00:00:00.000Z",
};

async function boot() {
  const dir = mkdtempSync(path.join(tmpdir(), "reservas-"));
  const running = await start({
    port: 0,
    dbPath: path.join(dir, "reservas.sqlite"),
    seed: true,
  });
  return running;
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  return { status: response.status, body };
}

test("cria, bloqueia cruzamento e libera depois do cancelamento", async () => {
  const app = await boot();
  try {
    const created = await json(`${app.url}/api/bookings`, {
      method: "POST",
      body: JSON.stringify({
        resourceId: "sala-norte",
        title: "Planejamento",
        startsAt: "2026-11-16T13:00:00.000Z",
        endsAt: "2026-11-16T14:00:00.000Z",
      }),
    });
    assert.equal(created.status, 201);

    const clash = await json(`${app.url}/api/bookings`, {
      method: "POST",
      body: JSON.stringify({
        resourceId: "sala-norte",
        title: "Outra",
        startsAt: "2026-11-16T13:30:00.000Z",
        endsAt: "2026-11-16T15:00:00.000Z",
      }),
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.conflicts.length, 1);
    assert.equal(clash.body.conflicts[0].title, "Planejamento");

    const adjacent = await json(`${app.url}/api/bookings`, {
      method: "POST",
      body: JSON.stringify({
        resourceId: "sala-norte",
        title: "Em seguida",
        startsAt: "2026-11-16T14:00:00.000Z",
        endsAt: "2026-11-16T15:00:00.000Z",
      }),
    });
    assert.equal(adjacent.status, 201);

    const otherRoom = await json(`${app.url}/api/bookings`, {
      method: "POST",
      body: JSON.stringify({
        resourceId: "sala-sul",
        title: "Mesmo horário",
        startsAt: "2026-11-16T13:00:00.000Z",
        endsAt: "2026-11-16T14:00:00.000Z",
      }),
    });
    assert.equal(otherRoom.status, 201);

    const cancelled = await json(`${app.url}/api/bookings/${created.body.booking.id}`, {
      method: "DELETE",
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.booking.status, "cancelled");

    const freed = await json(`${app.url}/api/bookings`, {
      method: "POST",
      body: JSON.stringify({
        resourceId: "sala-norte",
        title: "De novo",
        startsAt: "2026-11-16T13:00:00.000Z",
        endsAt: "2026-11-16T14:00:00.000Z",
      }),
    });
    assert.equal(freed.status, 201);

    const list = await json(
      `${app.url}/api/bookings?from=${encodeURIComponent(DAY.from)}&to=${encodeURIComponent(DAY.to)}`,
    );
    assert.equal(list.status, 200);
    assert.equal(list.body.bookings.some((item: { status: string }) => item.status === "cancelled"), false);
    assert.equal(list.body.bookings.length, 3);
  } finally {
    await app.close();
  }
});

test("sala inexistente e corpo inválido", async () => {
  const app = await boot();
  try {
    const missing = await json(`${app.url}/api/bookings`, {
      method: "POST",
      body: JSON.stringify({
        resourceId: "nao-existe",
        title: "Algo",
        startsAt: "2026-11-16T13:00:00.000Z",
        endsAt: "2026-11-16T14:00:00.000Z",
      }),
    });
    assert.equal(missing.status, 404);

    const invalid = await json(`${app.url}/api/bookings`, {
      method: "POST",
      body: JSON.stringify({ resourceId: "sala-norte", title: "" }),
    });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.fields.title);

    const gone = await json(`${app.url}/api/bookings/nao-existe`, { method: "DELETE" });
    assert.equal(gone.status, 404);

    const resources = await json(`${app.url}/api/resources`);
    assert.equal(resources.body.resources.length, 3);
  } finally {
    await app.close();
  }
});
