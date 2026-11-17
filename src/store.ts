import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Booking, BookingDraft, BookingStatus, Resource } from "./domain.ts";

type BookingRow = {
  id: string;
  resource_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
};

const SEED: Resource[] = [
  { id: "sala-norte", name: "Sala Norte" },
  { id: "sala-sul", name: "Sala Sul" },
  { id: "estudio", name: "Estúdio" },
];

function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    resourceId: row.resource_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(path.dirname(filename), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES resources(id),
        title TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'cancelled'))
      );
      CREATE INDEX IF NOT EXISTS bookings_window
        ON bookings (resource_id, status, starts_at, ends_at);
    `);
  }

  seed(): void {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM resources").get() as { count: number };
    if (row.count > 0) return;
    const insert = this.db.prepare("INSERT INTO resources (id, name) VALUES (?, ?)");
    for (const resource of SEED) insert.run(resource.id, resource.name);
  }

  insertResource(resource: Resource): void {
    this.db.prepare("INSERT INTO resources (id, name) VALUES (?, ?)").run(resource.id, resource.name);
  }

  listResources(): Resource[] {
    return this.db.prepare("SELECT id, name FROM resources ORDER BY name").all() as Resource[];
  }

  getResource(id: string): Resource | undefined {
    return this.db.prepare("SELECT id, name FROM resources WHERE id = ?").get(id) as Resource | undefined;
  }

  listBookings(filter: {
    from: string;
    to: string;
    resourceId?: string;
    status?: BookingStatus | "all";
  }): Booking[] {
    const status = filter.status ?? "active";
    const rows = this.db
      .prepare(
        `SELECT id, resource_id, title, starts_at, ends_at, status
         FROM bookings
         WHERE starts_at < ? AND ends_at > ?
           AND (? = 'all' OR status = ?)
           AND (? IS NULL OR resource_id = ?)
         ORDER BY starts_at, title`,
      )
      .all(
        filter.to,
        filter.from,
        status,
        status,
        filter.resourceId ?? null,
        filter.resourceId ?? null,
      ) as BookingRow[];
    return rows.map(mapBooking);
  }

  conflicts(resourceId: string, startsAt: string, endsAt: string): Booking[] {
    const rows = this.db
      .prepare(
        `SELECT id, resource_id, title, starts_at, ends_at, status
         FROM bookings
         WHERE resource_id = ?
           AND status = 'active'
           AND starts_at < ?
           AND ends_at > ?`,
      )
      .all(resourceId, endsAt, startsAt) as BookingRow[];
    return rows.map(mapBooking);
  }

  createBooking(id: string, draft: BookingDraft): { booking: Booking } | { conflicts: Booking[] } | { missing: true } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.getResource(draft.resourceId)) {
        this.db.exec("ROLLBACK");
        return { missing: true };
      }
      const conflicts = this.conflicts(draft.resourceId, draft.startsAt, draft.endsAt);
      if (conflicts.length > 0) {
        this.db.exec("ROLLBACK");
        return { conflicts };
      }
      this.db
        .prepare(
          `INSERT INTO bookings (id, resource_id, title, starts_at, ends_at, status)
           VALUES (?, ?, ?, ?, ?, 'active')`,
        )
        .run(id, draft.resourceId, draft.title, draft.startsAt, draft.endsAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      booking: {
        id,
        resourceId: draft.resourceId,
        title: draft.title,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        status: "active",
      },
    };
  }

  cancelBooking(id: string): Booking | undefined {
    const row = this.db
      .prepare("SELECT id, resource_id, title, starts_at, ends_at, status FROM bookings WHERE id = ?")
      .get(id) as BookingRow | undefined;
    if (!row) return undefined;
    if (row.status === "active") {
      this.db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
      row.status = "cancelled";
    }
    return mapBooking(row);
  }

  close(): void {
    this.db.close();
  }
}
