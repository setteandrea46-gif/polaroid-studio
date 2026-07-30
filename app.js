const config = window.POLAROID_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let supabase = null;
let isAdmin = false;
const adminHashParams = new URLSearchParams(location.hash.slice(1));
const adminKeyFromLink = adminHashParams.get("admin");
let adminKey = adminKeyFromLink || localStorage.getItem("polaroid-admin-key") || "";
if (adminKeyFromLink) {
  localStorage.setItem("polaroid-admin-key", adminKeyFromLink);
  history.replaceState({}, "", `${location.pathname}${location.search}`);
}
let photos = [];
let selectedFilter = "Tutti";
const requestedEventCode = new URLSearchParams(location.search).get("evento");

const $ = (id) => document.getElementById(id);
const grid = $("photoGrid");
const dialog = $("adminDialog");

const samples = [
  { id: "sample-1", event: "Summer Party", eventCode: "summer-party-demo", date: "2026-07-18", url: svgPhoto("#db8a62", "#394d62", "SUMMER"), sample: true },
  { id: "sample-2", event: "Matrimonio", eventCode: "matrimonio-demo", date: "2026-06-28", url: svgPhoto("#b98f7e", "#65705b", "LOVE"), sample: true },
  { id: "sample-3", event: "Compleanno", eventCode: "compleanno-demo", date: "2026-06-14", url: svgPhoto("#59475b", "#d5a957", "PARTY"), sample: true },
  { id: "sample-4", event: "Summer Party", eventCode: "summer-party-demo", date: "2026-07-18", url: svgPhoto("#4e7180", "#e2b172", "SUNSET"), sample: true },
  { id: "sample-5", event: "Matrimonio", eventCode: "matrimonio-demo", date: "2026-06-28", url: svgPhoto("#9c6458", "#d9cbb5", "FOREVER"), sample: true }
];

function svgPhoto(a, b, word) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="690" cy="260" r="130" fill="#ffe6a8" opacity=".65"/><path d="M0 790 Q230 600 430 780 T900 680 V1100 H0Z" fill="#17272d" opacity=".5"/><rect width="100%" height="100%" filter="url(#n)" opacity=".12"/><text x="50%" y="52%" text-anchor="middle" fill="white" opacity=".8" font-family="serif" font-size="80" letter-spacing="16">${word}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function init() {
  $("year").textContent = new Date().getFullYear();
  $("dateInput").valueAsDate = new Date();
  if (cloudEnabled) {
    const module = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabase = module.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      global: { headers: adminKey ? { "x-polaroid-admin-key": adminKey } : {} }
    });
    isAdmin = adminKey ? await checkAdmin() : false;
    if (adminKey && !isAdmin) {
      localStorage.removeItem("polaroid-admin-key");
      adminKey = "";
    }
    await loadCloudPhotos();
    $("modeNote").textContent = "Modalità online attiva: le foto pubblicate saranno visibili a tutti.";
  } else {
    photos = await readLocalPhotos();
    if (!photos.length) photos = samples;
    $("modeNote").textContent = "Per proteggere l’area amministratore e condividere i link evento, completa il collegamento sicuro a Supabase.";
  }
  render();
  bindEvents();
  if (isAdmin && adminKeyFromLink) {
    showAdminState();
    dialog.showModal();
  }
}

function bindEvents() {
  $("adminButton").onclick = () => { showAdminState(); dialog.showModal(); };
  $("closeDialog").onclick = () => dialog.close();
  dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); };
  $("logoutButton").onclick = logout;
  $("fileInput").onchange = (e) => $("fileCount").textContent = e.target.files.length ? `${e.target.files.length} file selezionati` : "";
  $("adminCodeForm").onsubmit = activateAdminCode;
  $("uploadForm").onsubmit = upload;
  $("searchInput").oninput = render;
  $("filters").onclick = (e) => {
    if (!e.target.dataset.filter) return;
    selectedFilter = e.target.dataset.filter;
    render();
  };
}

function showAdminState() {
  $("loginView").classList.toggle("hidden", isAdmin);
  $("adminView").classList.toggle("hidden", !isAdmin);
}

async function activateAdminCode(e) {
  e.preventDefault();
  const code = $("adminCodeInput").value.trim();
  if (!code) return;
  localStorage.setItem("polaroid-admin-key", code);
  location.reload();
}

async function checkAdmin() {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("is_admin_request");
  return !error && data === true;
}

async function logout() {
  localStorage.removeItem("polaroid-admin-key");
  location.reload();
}

async function loadCloudPhotos() {
  let query = supabase.from("photos").select("*").order("event_date", { ascending: false });
  if (!isAdmin) {
    if (!requestedEventCode) {
      photos = [];
      return;
    }
    query = query.eq("event_code", requestedEventCode);
  }
  const { data, error } = await query;
  if (error) return toast("Impossibile caricare la galleria");
  photos = (data || []).map(p => ({ id: p.id, event: p.event_name, eventCode: p.event_code, date: p.event_date, url: `${config.supabaseUrl}/storage/v1/object/public/photos/${p.storage_path}`, path: p.storage_path }));
}

async function upload(e) {
  e.preventDefault();
  const files = [...$("fileInput").files];
  if (!files.length) return;
  const button = $("publishButton");
  button.disabled = true; button.textContent = "Pubblicazione…";
  try {
    const eventCode = createEventCode();
    if (cloudEnabled) await uploadCloud(files, eventCode);
    else await uploadLocal(files, eventCode);
    $("uploadForm").reset(); $("fileCount").textContent = "";
    const eventLink = buildEventLink(eventCode);
    $("uploadMessage").innerHTML = `Box pubblicata. <button class="inline-copy" type="button" id="copyNewLink">Copia il link per il cliente</button>`;
    $("copyNewLink").onclick = () => copyEventLink(eventLink);
    render(); toast("Foto pubblicate!");
  } catch (err) {
    $("uploadMessage").textContent = err.message || "Qualcosa è andato storto.";
  } finally {
    button.disabled = false; button.textContent = "Pubblica nella galleria";
  }
}

async function uploadCloud(files, eventCode) {
  for (const file of files) {
    const safeName = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: storageError } = await supabase.storage.from("photos").upload(safeName, file);
    if (storageError) throw storageError;
    const { error: dbError } = await supabase.from("photos").insert({ event_name: $("eventInput").value, event_date: $("dateInput").value, event_code: eventCode, storage_path: safeName });
    if (dbError) throw dbError;
  }
  await loadCloudPhotos();
}

async function uploadLocal(files, eventCode) {
  if (photos.every(p => p.sample)) photos = [];
  for (const file of files) {
    const item = {
      id: crypto.randomUUID(),
      event: $("eventInput").value,
      eventCode,
      date: $("dateInput").value,
      blob: file,
      name: file.name
    };
    await saveLocalPhoto(item);
    photos.unshift({ ...item, url: URL.createObjectURL(file) });
  }
}

async function removePhoto(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo || !confirm("Vuoi eliminare questa fotografia?")) return;
  if (cloudEnabled) {
    const { error } = await supabase.from("photos").delete().eq("id", id);
    if (error) return toast("Eliminazione non riuscita");
    await supabase.storage.from("photos").remove([photo.path]);
    await loadCloudPhotos();
  } else {
    photos = photos.filter(p => p.id !== id);
    await deleteLocalPhoto(id);
  }
  render(); toast("Fotografia eliminata");
}

function render() {
  const query = $("searchInput").value.toLowerCase();
  const allowedPhotos = requestedEventCode && !isAdmin ? photos.filter(p => p.eventCode === requestedEventCode) : photos;
  const events = [...new Set(allowedPhotos.map(p => p.event))];
  $("filters").innerHTML = ["Tutti", ...events].map(x => `<button class="${x === selectedFilter ? "active" : ""}" data-filter="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("");
  const visible = allowedPhotos.filter(p => (selectedFilter === "Tutti" || p.event === selectedFilter) && (`${p.event} ${p.date}`.toLowerCase().includes(query)));
  grid.innerHTML = visible.map((p, i) => `
    <article class="photo-card">
      <div class="polaroid">
        ${isAdmin && !p.sample ? `<button class="delete-button" data-delete="${p.id}" aria-label="Elimina">×</button>` : ""}
        <img src="${p.url}" alt="${escapeHtml(p.event)}" loading="${i < 2 ? "eager" : "lazy"}">
        <div class="photo-info">
          <div><h3>${escapeHtml(p.event)}</h3><p>${formatDate(p.date)}</p></div>
          <button class="download-button" data-download="${p.id}" aria-label="Scarica foto">↓</button>
        </div>
      </div>
    </article>`).join("");
  $("emptyState").classList.toggle("hidden", visible.length > 0);
  grid.querySelectorAll("[data-download]").forEach(b => b.onclick = () => downloadPhoto(b.dataset.download));
  grid.querySelectorAll("[data-delete]").forEach(b => b.onclick = () => removePhoto(b.dataset.delete));
  renderEventLinks();
}

function renderEventLinks() {
  const container = $("eventLinks");
  if (!container || !isAdmin) return;
  const boxes = new Map();
  photos.filter(p => !p.sample && p.eventCode).forEach(p => {
    if (!boxes.has(p.eventCode)) boxes.set(p.eventCode, { name: p.event, date: p.date, count: 0 });
    boxes.get(p.eventCode).count += 1;
  });
  if (!boxes.size) {
    container.innerHTML = `<p class="no-events">Crea la prima box caricando le fotografie.</p>`;
    return;
  }
  container.innerHTML = [...boxes].map(([code, box]) => `
    <article class="event-link-card">
      <div>
        <strong>${escapeHtml(box.name)}</strong>
        <small>${formatDate(box.date)} · ${box.count} foto</small>
      </div>
      <div class="event-actions">
        <button type="button" data-copy-event="${code}">Copia link</button>
        <a href="${buildEventLink(code)}" target="_blank" aria-label="Apri box">↗</a>
      </div>
    </article>
  `).join("");
  container.querySelectorAll("[data-copy-event]").forEach(button => {
    button.onclick = () => copyEventLink(buildEventLink(button.dataset.copyEvent));
  });
}

function createEventCode() {
  return `${slugify($("eventInput").value)}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildEventLink(code) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("evento", code);
  return url.toString();
}

async function copyEventLink(link) {
  try {
    await navigator.clipboard.writeText(link);
    toast("Link dell’evento copiato");
  } catch {
    prompt("Copia questo link e invialo al cliente:", link);
  }
}

function slugify(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 35);
}

async function downloadPhoto(id) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  try {
    const response = await fetch(p.url);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${p.event.replace(/\s+/g, "-")}-${p.date}.jpg`; a.click();
    URL.revokeObjectURL(url); toast("Download avviato");
  } catch { window.open(p.url, "_blank"); }
}

const DB_NAME = "polaroid-studio";
const STORE_NAME = "photos";

function openLocalDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readLocalPhotos() {
  try {
    const db = await openLocalDb();
    const stored = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return stored
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(item => ({
        ...item,
        eventCode: item.eventCode || `archivio-${slugify(item.event)}-${item.date}`,
        url: URL.createObjectURL(item.blob)
      }));
  } catch {
    return [];
  }
}

async function saveLocalPhoto(photo) {
  try {
    const db = await openLocalDb();
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(photo);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {
    throw new Error("Il telefono non concede spazio sufficiente. Libera memoria oppure attiva l’archivio cloud.");
  }
}

async function deleteLocalPhoto(id) {
  const db = await openLocalDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}
function formatDate(date) { return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function toast(message) { $("toast").textContent = message; $("toast").classList.add("show"); setTimeout(() => $("toast").classList.remove("show"), 2200); }

init().catch(() => toast("Errore di avvio. Controlla la configurazione."));
