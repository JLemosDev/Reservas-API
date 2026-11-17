const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;

const dayInput = document.querySelector("#day");
const dayForm = document.querySelector("#day-form");
const titleEl = document.querySelector("#day-title");
const rulerEl = document.querySelector("#ruler");
const listEl = document.querySelector("#list");
const bookForm = document.querySelector("#book-form");
const resourceSelect = document.querySelector("#resource");
const noteEl = document.querySelector("#form-note");
const startsInput = document.querySelector("#starts");
const endsInput = document.querySelector("#ends");

const state = {
  day: dayFromUrl(),
  resources: [],
  bookings: [],
  status: "loading",
};

dayInput.value = state.day;
titleEl.textContent = formatDay(state.day);
fillDefaultTimes();

dayForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setDay(dayInput.value);
});

dayInput.addEventListener("change", () => setDay(dayInput.value));

bookForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = bookForm.querySelector("[type=submit]");
  note("");
  clearInvalid();
  submit.disabled = true;
  try {
    const payload = {
      resourceId: resourceSelect.value,
      title: bookForm.title.value,
      startsAt: new Date(startsInput.value).toISOString(),
      endsAt: new Date(endsInput.value).toISOString(),
    };
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (response.status === 409) {
      const other = body.conflicts?.[0];
      note(
        other
          ? `Cruza com “${other.title}”, ${formatClock(other.startsAt)}–${formatClock(other.endsAt)}.`
          : body.message,
        "error",
      );
      return;
    }
    if (!response.ok) {
      applyFields(body.fields);
      note(body.message ?? "Não deu para marcar.", "error");
      return;
    }
    bookForm.title.value = "";
    note("Marcada.");
    await load();
  } catch {
    note("Sem resposta do servidor.", "error");
  } finally {
    submit.disabled = false;
  }
});

listEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.retry !== undefined) {
    await load();
    return;
  }
  if (button.dataset.ask !== undefined) {
    const row = button.closest("tr");
    row.querySelector("[data-ask]")?.toggleAttribute("hidden", true);
    row.querySelector("[data-confirm]")?.toggleAttribute("hidden", false);
    return;
  }
  if (button.dataset.confirm !== undefined) {
    button.disabled = true;
    try {
      const response = await fetch(`/api/bookings/${button.dataset.confirm}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        note(body.message ?? "Não deu para cancelar.", "error");
        return;
      }
      note("Cancelada.");
      await load();
    } catch {
      note("Sem resposta do servidor.", "error");
    }
  }
});

load();

function dayFromUrl() {
  const value = new URLSearchParams(location.search).get("day");
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : today();
}

function today() {
  const now = new Date();
  return localDate(now);
}

function localDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function setDay(day) {
  if (!day) return;
  state.day = day;
  const url = new URL(location.href);
  url.searchParams.set("day", day);
  history.replaceState(null, "", url);
  titleEl.textContent = formatDay(day);
  fillDefaultTimes();
  load();
}

function formatDay(day) {
  const date = new Date(`${day}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatClock(iso) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function fillDefaultTimes() {
  if (!startsInput.value) startsInput.value = `${state.day}T09:00`;
  if (!endsInput.value) endsInput.value = `${state.day}T10:00`;
  const startDay = startsInput.value.slice(0, 10);
  if (startDay !== state.day) {
    startsInput.value = `${state.day}T09:00`;
    endsInput.value = `${state.day}T10:00`;
  }
}

function dayBounds(day) {
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(`${day}T00:00:00`);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function load() {
  state.status = "loading";
  render();
  const bounds = dayBounds(state.day);
  try {
    const [resourcesRes, bookingsRes] = await Promise.all([
      fetch("/api/resources"),
      fetch(`/api/bookings?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`),
    ]);
    if (!resourcesRes.ok || !bookingsRes.ok) throw new Error("load");
    const resourcesBody = await resourcesRes.json();
    const bookingsBody = await bookingsRes.json();
    state.resources = resourcesBody.resources;
    state.bookings = bookingsBody.bookings;
    state.status = "ready";
    fillResources();
  } catch {
    state.status = "error";
  }
  render();
}

function fillResources() {
  const current = resourceSelect.value;
  resourceSelect.replaceChildren();
  for (const resource of state.resources) {
    const option = document.createElement("option");
    option.value = resource.id;
    option.textContent = resource.name;
    resourceSelect.append(option);
  }
  if (state.resources.some((item) => item.id === current)) resourceSelect.value = current;
}

function render() {
  rulerEl.setAttribute("aria-busy", state.status === "loading" ? "true" : "false");
  listEl.setAttribute("aria-busy", state.status === "loading" ? "true" : "false");
  if (state.status === "loading") {
    rulerEl.replaceChildren(skeleton(), skeleton());
    listEl.replaceChildren(skeleton());
    return;
  }
  if (state.status === "error") {
    rulerEl.replaceChildren(errorBlock("Não deu para carregar este dia."));
    listEl.replaceChildren(errorBlock("Não deu para listar as reservas."));
    return;
  }
  renderRuler();
  renderTable();
}

function skeleton() {
  const bar = document.createElement("div");
  bar.className = "skeleton";
  return bar;
}

function errorBlock(message) {
  const wrap = document.createElement("div");
  const line = document.createElement("p");
  line.className = "error-line";
  line.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key retry";
  button.dataset.retry = "";
  button.textContent = "Tentar de novo";
  wrap.append(line, button);
  return wrap;
}

function renderRuler() {
  const wrap = document.createElement("div");
  wrap.className = "ruler";
  const scale = document.createElement("div");
  scale.className = "scale";
  scale.setAttribute("aria-hidden", "true");
  const spacer = document.createElement("span");
  const ticks = document.createElement("div");
  ticks.className = "ticks";
  for (let hour = OPEN_HOUR; hour <= CLOSE_HOUR; hour += 2) {
    const tick = document.createElement("span");
    tick.textContent = String(hour);
    ticks.append(tick);
  }
  scale.append(spacer, ticks);
  wrap.append(scale);

  if (state.resources.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nenhuma sala cadastrada.";
    wrap.append(empty);
    rulerEl.replaceChildren(wrap);
    return;
  }

  const open = new Date(`${state.day}T${String(OPEN_HOUR).padStart(2, "0")}:00:00`).getTime();
  const close = new Date(`${state.day}T${String(CLOSE_HOUR).padStart(2, "0")}:00:00`).getTime();
  const span = close - open;

  for (const resource of state.resources) {
    const lane = document.createElement("div");
    lane.className = "lane";
    const name = document.createElement("div");
    name.className = "lane-name";
    name.textContent = resource.name;
    const track = document.createElement("div");
    track.className = "track";
    track.setAttribute("role", "list");
    track.setAttribute("aria-label", resource.name);
    for (const booking of state.bookings.filter((item) => item.resourceId === resource.id)) {
      const start = new Date(booking.startsAt).getTime();
      const end = new Date(booking.endsAt).getTime();
      const left = Math.max(0, (start - open) / span);
      const right = Math.min(1, (end - open) / span);
      if (right <= left) continue;
      const block = document.createElement("div");
      block.className = "block";
      block.setAttribute("role", "listitem");
      block.style.left = `${left * 100}%`;
      block.style.width = `${(right - left) * 100}%`;
      block.title = `${booking.title}, ${formatClock(booking.startsAt)}–${formatClock(booking.endsAt)}`;
      block.textContent = booking.title;
      track.append(block);
    }
    lane.append(name, track);
    wrap.append(lane);
  }
  rulerEl.replaceChildren(wrap);
}

function renderTable() {
  if (state.bookings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nenhuma reserva neste dia.";
    listEl.replaceChildren(empty);
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Sala", "Título", "Começa", "Termina", "Ação"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    cell.scope = "col";
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  const names = new Map(state.resources.map((item) => [item.id, item.name]));
  for (const booking of state.bookings) {
    const row = document.createElement("tr");
    row.append(
      cell(names.get(booking.resourceId) ?? booking.resourceId, "Sala"),
      cell(booking.title, "Título"),
      cell(formatClock(booking.startsAt), "Começa", true),
      cell(formatClock(booking.endsAt), "Termina", true),
    );
    const action = document.createElement("td");
    action.dataset.label = "Ação";
    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "key";
    ask.dataset.ask = booking.id;
    ask.textContent = "Cancelar";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "key";
    confirm.dataset.confirm = booking.id;
    confirm.hidden = true;
    confirm.textContent = "Confirmar";
    action.append(ask, confirm);
    row.append(action);
    body.append(row);
  }
  table.append(head, body);
  listEl.replaceChildren(table);
}

function cell(text, label, mono = false) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.textContent = text;
  if (mono) td.className = "when";
  return td;
}

function note(message, tone) {
  noteEl.textContent = message;
  if (tone) noteEl.dataset.tone = tone;
  else delete noteEl.dataset.tone;
}

function clearInvalid() {
  for (const field of bookForm.querySelectorAll("[aria-invalid]")) {
    field.removeAttribute("aria-invalid");
  }
}

function applyFields(fields = {}) {
  const map = { resourceId: "resource", title: "title", startsAt: "starts", endsAt: "ends" };
  let first = null;
  for (const [key, id] of Object.entries(map)) {
    if (!fields[key]) continue;
    const field = document.getElementById(id);
    field.setAttribute("aria-invalid", "true");
    first ??= field;
  }
  first?.focus();
}
