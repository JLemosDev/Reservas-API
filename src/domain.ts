export type BookingStatus = "active" | "cancelled";

export type Resource = {
  id: string;
  name: string;
};

export type Booking = {
  id: string;
  resourceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
};

export type BookingDraft = {
  resourceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

export type FieldErrors = Record<string, string>;

const TITLE_MAX = 80;

export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function readInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function parseBookingDraft(
  input: unknown,
): { ok: true; value: BookingDraft } | { ok: false; fields: FieldErrors } {
  const record = asRecord(input);
  const fields: FieldErrors = {};
  if (!record) {
    return { ok: false, fields: { body: "Envie um objeto JSON." } };
  }

  const resourceId = typeof record.resourceId === "string" ? record.resourceId.trim() : "";
  if (!resourceId) fields.resourceId = "Escolha uma sala.";

  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) fields.title = "Dê um nome à reserva.";
  else if (title.length > TITLE_MAX) fields.title = `No máximo ${TITLE_MAX} caracteres.`;

  const startsAt = readInstant(record.startsAt);
  const endsAt = readInstant(record.endsAt);
  if (!startsAt) fields.startsAt = "Começo inválido.";
  if (!endsAt) fields.endsAt = "Término inválido.";
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    fields.endsAt = "O término precisa ser depois do começo.";
  }

  if (Object.keys(fields).length > 0 || !startsAt || !endsAt) {
    return { ok: false, fields };
  }

  return { ok: true, value: { resourceId, title, startsAt, endsAt } };
}

export function parseWindow(
  from: string | null,
  to: string | null,
): { ok: true; from: string; to: string } | { ok: false; message: string } {
  if (!from || !to) return { ok: false, message: "Informe from e to." };
  const start = readInstant(from);
  const end = readInstant(to);
  if (!start || !end) return { ok: false, message: "from ou to inválido." };
  if (Date.parse(start) >= Date.parse(end)) {
    return { ok: false, message: "to precisa ser depois de from." };
  }
  return { ok: true, from: start, to: end };
}
