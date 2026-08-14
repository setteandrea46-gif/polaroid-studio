const config = window.POLAROID_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let supabase = null;
let supabaseModule = null;
let isAdmin = false;
let adminIdentifier = localStorage.getItem("polaroid-admin-identifier") || readCookie("polaroid-admin-identifier") || "";
let adminPassword = localStorage.getItem("polaroid-admin-password") || readCookie("polaroid-admin-password") || "";
let pendingEventCode = "";
localStorage.removeItem("polaroid-admin-key");
let photos = [];
let selectedFilter = "Tutti";
let selectedAdminEventCode = "";
const requestedEventCode = new URLSearchParams(location.search).get("evento");
const clientMode = Boolean(requestedEventCode);
const FREE_STORAGE_BYTES = 1024 * 1024 * 1024;
const BRANDING_SETTINGS_PATH = "branding/settings.json";
const DEFAULT_BRANDING = { companyName: "Polaroid Studio", logoPath: "" };
let branding = { ...DEFAULT_BRANDING, logoUrl: "" };
let brandingPreviewUrl = "";
let removeBrandLogo = false;
let gallerySessionId = "";
let galleryHeartbeatTimer = null;

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
  document.body.classList.toggle("client-view", clientMode);
  if (cloudEnabled) {
    supabaseModule = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    const useStoredAdmin = !clientMode && adminIdentifier && adminPassword;
    supabase = createSupabaseClient(useStoredAdmin ? adminIdentifier : "", useStoredAdmin ? adminPassword : "");
    const adminCheck = useStoredAdmin ? await checkAdmin(supabase) : false;
    isAdmin = adminCheck === true || adminCheck === null;
    if (useStoredAdmin && adminCheck === false) {
      if (!clientMode) {
        clearAdminCredentials();
        supabase = createSupabaseClient("", "");
      }
    }
    await loadCloudPhotos();
    if (clientMode && photos.length) await startGallerySession();
    $("modeNote").textContent = "Modalità online attiva: le foto pubblicate saranno visibili a tutti.";
  } else {
    photos = await readLocalPhotos();
    if (!photos.length) photos = samples;
    $("modeNote").textContent = "Per proteggere l’area amministratore e condividere i link evento, completa il collegamento sicuro a Supabase.";
  }
  await loadBranding();
  document.body.classList.toggle("public-home", !clientMode && !isAdmin);
  render();
  bindEvents();
  if (cloudEnabled && isAdmin) await updateAdminOverview();
  if (cloudEnabled && isAdmin) {
    setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      await loadCloudPhotos();
      render();
      await loadAdminStats();
    }, 3000);
  }
}

function bindEvents() {
  if (!clientMode) {
    $("adminButton").onclick = async () => {
      if (cloudEnabled && isAdmin) {
        await loadCloudPhotos();
        render();
      }
      showAdminState();
      dialog.showModal();
    };
    $("closeDialog").onclick = () => dialog.close();
    dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); };
    $("logoutButton").onclick = logout;
    $("settingsButton").onclick = openBrandingSettings;
    $("closeSettingsButton").onclick = closeBrandingSettings;
    $("brandingForm").onsubmit = saveBranding;
    $("companyNameInput").oninput = renderBrandingPreview;
    $("companyLogoInput").onchange = selectBrandingLogo;
    $("removeLogoButton").onclick = removeBrandingLogo;
    $("fileInput").onchange = (e) => {
      const count = e.target.files.length;
      $("fileCount").textContent = count ? `${count} file selezionati` : "";
      resetUploadProgress();
    };
    $("adminLoginForm").onsubmit = loginAdmin;
    $("uploadForm").onsubmit = upload;
    $("addFilesInput").onchange = uploadAdditionalFiles;
  }
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

function createSupabaseClient(identifier, password) {
  const headers = identifier && password ? {
    "x-polaroid-admin-identifier": identifier,
    "x-polaroid-admin-password": password
  } : {};
  return supabaseModule.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: identifier && password ? "polaroid-admin-session" : "polaroid-public-session"
    }
  });
}

async function loginAdmin(e) {
  e.preventDefault();
  const identifier = $("adminIdentifierInput").value.trim();
  const password = $("adminPasswordInput").value;
  const message = $("adminLoginMessage");
  const button = $("adminLoginButton");
  if (!cloudEnabled || !supabaseModule) {
    message.textContent = "Collegamento online non disponibile.";
    return;
  }
  button.disabled = true;
  message.textContent = "Controllo in corso…";
  const candidateClient = createSupabaseClient(identifier, password);
  const accepted = await checkAdmin(candidateClient);
  button.disabled = false;
  if (!accepted) {
    message.textContent = "Nome utente, e-mail o password non corretti. Puoi riprovare subito.";
    return;
  }
  localStorage.setItem("polaroid-admin-identifier", identifier);
  localStorage.setItem("polaroid-admin-password", password);
  writeCookie("polaroid-admin-identifier", identifier);
  writeCookie("polaroid-admin-password", password);
  location.reload();
}

async function checkAdmin(client = supabase) {
  if (!client) return false;
  const { data, error } = await client.rpc("is_admin_request");
  if (error) return null;
  return data === true;
}

async function logout() {
  clearAdminCredentials();
  location.reload();
}

function clearAdminCredentials() {
  localStorage.removeItem("polaroid-admin-identifier");
  localStorage.removeItem("polaroid-admin-password");
  deleteCookie("polaroid-admin-identifier");
  deleteCookie("polaroid-admin-password");
  adminIdentifier = "";
  adminPassword = "";
}

function readCookie(name) {
  const prefix = `${name}=`;
  const item = document.cookie.split("; ").find(value => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}

function writeCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
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
  photos = (data || []).map(p => ({
    id: p.id,
    event: p.event_name,
    eventCode: p.event_code,
    date: p.event_date,
    downloads: Number(p.download_count || 0),
    url: publicPhotoUrl(p.preview_storage_path || p.storage_path),
    originalUrl: publicPhotoUrl(p.storage_path),
    path: p.storage_path,
    previewPath: p.preview_storage_path || ""
  }));
}

async function updateStorageUsage() {
  if (!cloudEnabled || !supabase || !isAdmin || clientMode) return;
  $("adminOverview").classList.remove("hidden");
  const meter = $("storageMeter");
  $("storageUsageText").textContent = "Calcolo spazio…";
  let totalBytes = 0;
  const folders = new Set(["", "branding"]);
  photos.flatMap(photo => [photo.path, photo.previewPath]).filter(Boolean).forEach(path => {
    const parts = String(path).split("/");
    parts.pop();
    folders.add(parts.join("/"));
  });
  for (const folder of folders) {
    let offset = 0;
    const pageSize = 100;
    while (true) {
      const { data, error } = await supabase.storage.from("photos").list(folder, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" }
      });
      if (error) {
        $("storageUsageText").textContent = "Spazio non disponibile";
        $("storageRemainingText").textContent = "Riprova aggiornando la pagina";
        return;
      }
      (data || []).forEach(file => { totalBytes += Number(file.metadata?.size || 0); });
      if (!data || data.length < pageSize) break;
      offset += data.length;
    }
  }
  const percent = Math.min(100, (totalBytes / FREE_STORAGE_BYTES) * 100);
  const remaining = Math.max(0, FREE_STORAGE_BYTES - totalBytes);
  $("storageUsageText").textContent = `${formatStorageBytes(totalBytes)} di 1 GB in uso (${percent.toFixed(1)}%)`;
  $("storageRemainingText").textContent = `${formatStorageBytes(remaining)} ancora disponibili`;
  $("storageBarFill").style.width = `${totalBytes ? Math.max(.5, percent) : 0}%`;
  meter.classList.toggle("warning", percent >= 85);
}

async function updateAdminOverview() {
  await Promise.all([updateStorageUsage(), loadAdminStats()]);
}

async function loadAdminStats() {
  if (!cloudEnabled || !supabase || !isAdmin || clientMode) return;
  $("adminOverview").classList.remove("hidden");
  let { data, error } = await supabase.rpc("get_admin_engagement_stats");
  if (error) ({ data, error } = await supabase.rpc("get_admin_gallery_stats"));
  if (error) {
    $("audienceUpdateText").textContent = "Statistiche non disponibili";
    return;
  }
  const stats = Array.isArray(data) ? data[0] : data;
  $("totalVisitors").textContent = Number(stats?.total_visitors || 0).toLocaleString("it-IT");
  $("totalDownloads").textContent = Number(stats?.total_downloads || 0).toLocaleString("it-IT");
  $("averageTime").textContent = formatDuration(Number(stats?.average_session_seconds || 0));
  $("audienceUpdateText").textContent = "Aggiornato automaticamente";
}

async function startGallerySession() {
  if (!clientMode || !requestedEventCode || !supabase) return;
  gallerySessionId = crypto.randomUUID();
  await Promise.all([
    supabase.rpc("record_gallery_visit", {
      target_event_code: requestedEventCode,
      target_visitor_key: crypto.randomUUID()
    }),
    heartbeatGallerySession()
  ]);
  galleryHeartbeatTimer = setInterval(() => {
    if (document.visibilityState === "visible") heartbeatGallerySession();
  }, 10000);
  document.addEventListener("visibilitychange", () => heartbeatGallerySession(document.visibilityState === "hidden"));
  window.addEventListener("pagehide", () => heartbeatGallerySession(true), { once: true });
}

async function heartbeatGallerySession(keepalive = false) {
  if (!gallerySessionId || !requestedEventCode || !supabase) return;
  const body = {
    target_event_code: requestedEventCode,
    target_session_id: gallerySessionId
  };
  if (!keepalive) {
    await supabase.rpc("record_gallery_session", body);
    return;
  }
  fetch(`${config.supabaseUrl}/rest/v1/rpc/record_gallery_session`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${config.supabaseAnonKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    keepalive: true
  }).catch(() => {});
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatStorageBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function publicPhotoUrl(path) {
  const encodedPath = String(path).split("/").map(encodeURIComponent).join("/");
  return `${config.supabaseUrl}/storage/v1/object/public/photos/${encodedPath}`;
}

async function loadBranding() {
  let saved = null;
  if (cloudEnabled) {
    try {
      const response = await fetch(`${publicPhotoUrl(BRANDING_SETTINGS_PATH)}?v=${Date.now()}`, { cache: "no-store" });
      if (response.ok) saved = await response.json();
    } catch {
      saved = null;
    }
  } else {
    try {
      saved = JSON.parse(localStorage.getItem("polaroid-branding") || "null");
    } catch {
      saved = null;
    }
  }
  const companyName = String(saved?.companyName || DEFAULT_BRANDING.companyName).trim().slice(0, 60);
  const logoPath = String(saved?.logoPath || "");
  branding = {
    companyName: companyName || DEFAULT_BRANDING.companyName,
    logoPath,
    logoUrl: cloudEnabled && logoPath ? `${publicPhotoUrl(logoPath)}?v=${Date.now()}` : String(saved?.logoUrl || "")
  };
  applyBranding();
}

function applyBranding() {
  const initial = branding.companyName.trim().charAt(0).toUpperCase() || "P";
  document.querySelectorAll("[data-brand-name]").forEach(element => { element.textContent = branding.companyName; });
  document.querySelectorAll("[data-brand-mark]").forEach(mark => {
    const logo = mark.querySelector("[data-brand-logo]");
    const fallback = mark.querySelector("[data-brand-initial]");
    mark.classList.toggle("has-logo", Boolean(branding.logoUrl));
    logo.classList.toggle("hidden", !branding.logoUrl);
    logo.src = branding.logoUrl || "";
    logo.alt = branding.logoUrl ? `Logo ${branding.companyName}` : "";
    fallback.classList.toggle("hidden", Boolean(branding.logoUrl));
    fallback.textContent = initial;
  });
  if ($("homeBrand")) $("homeBrand").setAttribute("aria-label", `${branding.companyName}, home`);
  if (!clientMode) document.title = `${branding.companyName} — I tuoi ricordi`;
}

function openBrandingSettings() {
  removeBrandLogo = false;
  $("companyLogoInput").value = "";
  $("companyNameInput").value = branding.companyName;
  $("brandingMessage").textContent = "";
  $("brandingSettings").classList.remove("hidden");
  renderBrandingPreview();
  requestAnimationFrame(() => $("brandingSettings").scrollIntoView({ behavior: "smooth", block: "start" }));
}

function closeBrandingSettings() {
  $("brandingSettings").classList.add("hidden");
  if (brandingPreviewUrl) URL.revokeObjectURL(brandingPreviewUrl);
  brandingPreviewUrl = "";
  requestAnimationFrame(() => $("uploadForm").scrollIntoView({ behavior: "smooth", block: "start" }));
}

function selectBrandingLogo(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    e.target.value = "";
    $("brandingMessage").textContent = "Scegli un file immagine.";
    return;
  }
  if (brandingPreviewUrl) URL.revokeObjectURL(brandingPreviewUrl);
  brandingPreviewUrl = URL.createObjectURL(file);
  removeBrandLogo = false;
  $("brandingMessage").textContent = "";
  renderBrandingPreview();
}

function removeBrandingLogo() {
  removeBrandLogo = true;
  $("companyLogoInput").value = "";
  if (brandingPreviewUrl) URL.revokeObjectURL(brandingPreviewUrl);
  brandingPreviewUrl = "";
  renderBrandingPreview();
}

function renderBrandingPreview() {
  const name = $("companyNameInput").value.trim() || DEFAULT_BRANDING.companyName;
  const logoUrl = removeBrandLogo ? "" : (brandingPreviewUrl || branding.logoUrl);
  const mark = $("brandingPreviewMark");
  const logo = $("brandingPreviewLogo");
  const initial = $("brandingPreviewInitial");
  $("brandingPreviewName").textContent = name;
  mark.classList.toggle("has-logo", Boolean(logoUrl));
  logo.classList.toggle("hidden", !logoUrl);
  logo.src = logoUrl || "";
  initial.classList.toggle("hidden", Boolean(logoUrl));
  initial.textContent = name.charAt(0).toUpperCase() || "P";
}

async function saveBranding(e) {
  e.preventDefault();
  const companyName = $("companyNameInput").value.trim();
  const logoFile = $("companyLogoInput").files[0];
  const button = $("saveBrandingButton");
  const message = $("brandingMessage");
  if (!companyName) return;
  let uploadedLogoPath = "";
  button.disabled = true;
  button.textContent = "Salvataggio…";
  message.textContent = "";
  try {
    let logoPath = removeBrandLogo ? "" : branding.logoPath;
    if (cloudEnabled && logoFile) {
      const safeName = logoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      uploadedLogoPath = `branding/logo-${crypto.randomUUID()}-${safeName}`;
      const { error: logoError } = await supabase.storage.from("photos").upload(uploadedLogoPath, logoFile, {
        contentType: logoFile.type || "application/octet-stream",
        cacheControl: "3600"
      });
      if (logoError) throw logoError;
      logoPath = uploadedLogoPath;
    }
    const nextBranding = { companyName: companyName.slice(0, 60), logoPath };
    if (cloudEnabled) {
      const settingsFile = new Blob([JSON.stringify(nextBranding)], { type: "application/json" });
      await supabase.storage.from("photos").remove([BRANDING_SETTINGS_PATH]);
      const { error: settingsError } = await supabase.storage.from("photos").upload(BRANDING_SETTINGS_PATH, settingsFile, {
        contentType: "application/json",
        cacheControl: "0"
      });
      if (settingsError) throw settingsError;
      const previousLogoPath = branding.logoPath;
      branding = { ...nextBranding, logoUrl: logoPath ? `${publicPhotoUrl(logoPath)}?v=${Date.now()}` : "" };
      if (previousLogoPath && previousLogoPath !== logoPath) await supabase.storage.from("photos").remove([previousLogoPath]);
    } else {
      const logoUrl = logoFile ? await fileToDataUrl(logoFile) : (removeBrandLogo ? "" : branding.logoUrl);
      branding = { ...nextBranding, logoUrl };
      localStorage.setItem("polaroid-branding", JSON.stringify(branding));
    }
    removeBrandLogo = false;
    $("companyLogoInput").value = "";
    applyBranding();
    renderBrandingPreview();
    message.textContent = "Impostazioni salvate e visibili ai clienti.";
    toast("Nome e logo aggiornati");
  } catch (error) {
    if (cloudEnabled && uploadedLogoPath) await supabase.storage.from("photos").remove([uploadedLogoPath]);
    message.textContent = error.message || "Salvataggio non riuscito.";
  } finally {
    button.disabled = false;
    button.textContent = "Salva impostazioni";
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function upload(e) {
  e.preventDefault();
  const files = [...$("fileInput").files];
  if (!files.length) return;
  const button = $("publishButton");
  button.disabled = true; button.textContent = "Pubblicazione…";
  updateUploadProgress(0, files.length);
  try {
    const eventCode = createEventCode();
    const showProgress = (current, total) => updateUploadProgress(current, total);
    if (cloudEnabled) await uploadCloud(files, eventCode, $("eventInput").value, $("dateInput").value, showProgress);
    else await uploadLocal(files, eventCode, $("eventInput").value, $("dateInput").value, showProgress);
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

function updateUploadProgress(current, total) {
  const progress = $("uploadProgress");
  if (!progress) return;
  const percent = total ? Math.round((current / total) * 100) : 0;
  progress.classList.toggle("hidden", !total);
  $("uploadProgressText").textContent = `Foto ${current} su ${total}`;
  $("uploadProgressPercent").textContent = `${percent}%`;
  $("uploadProgressFill").style.width = `${percent}%`;
}

function resetUploadProgress() {
  const progress = $("uploadProgress");
  if (!progress) return;
  progress.classList.add("hidden");
  $("uploadProgressText").textContent = "Foto 0 su 0";
  $("uploadProgressPercent").textContent = "0%";
  $("uploadProgressFill").style.width = "0%";
}

async function uploadCloud(files, eventCode, eventName = $("eventInput").value, eventDate = $("dateInput").value, onProgress = null) {
  for (const [index, file] of files.entries()) {
    const photoId = crypto.randomUUID();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeName = `${eventCode}/${photoId}-${safeFileName}`;
    const previewName = `previews/${eventCode}/${photoId}.jpg`;
    const previewBlob = await createPhotoPreview(file);
    const uploadedPaths = [];
    try {
      const { error: storageError } = await supabase.storage.from("photos").upload(safeName, file, {
        cacheControl: "31536000",
        contentType: file.type || "application/octet-stream"
      });
      if (storageError) throw storageError;
      uploadedPaths.push(safeName);
      const { error: previewError } = await supabase.storage.from("photos").upload(previewName, previewBlob, {
        cacheControl: "31536000",
        contentType: "image/jpeg"
      });
      if (previewError) throw previewError;
      uploadedPaths.push(previewName);
      let { error: dbError } = await supabase.from("photos").insert({
        event_name: eventName,
        event_date: eventDate,
        event_code: eventCode,
        storage_path: safeName,
        preview_storage_path: previewName
      });
      if (dbError && /preview_storage_path/i.test(dbError.message || "")) {
        await supabase.storage.from("photos").remove([previewName]);
        uploadedPaths.splice(uploadedPaths.indexOf(previewName), 1);
        ({ error: dbError } = await supabase.from("photos").insert({
          event_name: eventName,
          event_date: eventDate,
          event_code: eventCode,
          storage_path: safeName
        }));
      }
      if (dbError) throw dbError;
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from("photos").remove(uploadedPaths);
      throw error;
    }
    onProgress?.(index + 1, files.length);
  }
  await loadCloudPhotos();
  await updateStorageUsage();
}

async function uploadLocal(files, eventCode, eventName = $("eventInput").value, eventDate = $("dateInput").value, onProgress = null) {
  if (photos.every(p => p.sample)) photos = [];
  for (const [index, file] of files.entries()) {
    const previewBlob = await createPhotoPreview(file);
    const item = {
      id: crypto.randomUUID(),
      event: eventName,
      eventCode,
      date: eventDate,
      blob: file,
      previewBlob,
      name: file.name
    };
    await saveLocalPhoto(item);
    photos.unshift({ ...item, url: URL.createObjectURL(previewBlob), originalUrl: URL.createObjectURL(file) });
    onProgress?.(index + 1, files.length);
  }
}

async function createPhotoPreview(file) {
  const image = await decodePhoto(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Il telefono non riesce a creare l’anteprima");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (typeof image.close === "function") image.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Anteprima non creata")), "image/jpeg", .74);
  });
}

async function decodePhoto(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Alcuni formati di iPhone richiedono il caricamento tramite elemento Image.
    }
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Immagine non leggibile")); };
    image.src = url;
  });
}

async function uploadAdditionalFiles(e) {
  const files = [...e.target.files];
  const eventPhoto = photos.find(photo => photo.eventCode === pendingEventCode);
  e.target.value = "";
  if (!files.length || !eventPhoto) return;
  toast(`Aggiunta di ${files.length} foto in corso…`);
  try {
    if (cloudEnabled) {
      await uploadCloud(files, pendingEventCode, eventPhoto.event, eventPhoto.date, (current, total) => toast(`Foto ${current} su ${total} aggiunta…`));
    } else {
      await uploadLocal(files, pendingEventCode, eventPhoto.event, eventPhoto.date, (current, total) => toast(`Foto ${current} su ${total} aggiunta…`));
    }
    render();
    toast(`${files.length} foto aggiunte a ${eventPhoto.event}`);
  } catch (error) {
    toast(error.message || "Aggiunta delle foto non riuscita");
  } finally {
    pendingEventCode = "";
  }
}

async function removePhoto(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo || !confirm("Vuoi eliminare questa fotografia?")) return;
  if (cloudEnabled) {
    const { error } = await supabase.from("photos").delete().eq("id", id);
    if (error) return toast("Eliminazione non riuscita");
    await supabase.storage.from("photos").remove([photo.path, photo.previewPath].filter(Boolean));
    await loadCloudPhotos();
    await updateStorageUsage();
  } else {
    photos = photos.filter(p => p.id !== id);
    await deleteLocalPhoto(id);
  }
  render(); toast("Fotografia eliminata");
}

async function removeEventBox(eventCode) {
  const eventPhotos = photos.filter(photo => photo.eventCode === eventCode && !photo.sample);
  if (!eventPhotos.length) return;
  const eventName = eventPhotos[0].event;
  const confirmed = confirm(`Vuoi eliminare definitivamente la box "${eventName}" e tutte le sue ${eventPhotos.length} foto?`);
  if (!confirmed) return;
  try {
    if (cloudEnabled) {
      const paths = eventPhotos.flatMap(photo => [photo.path, photo.previewPath]).filter(Boolean);
      for (let index = 0; index < paths.length; index += 100) {
        const { error: storageError } = await supabase.storage.from("photos").remove(paths.slice(index, index + 100));
        if (storageError) throw storageError;
      }
      const { error: databaseError } = await supabase.from("photos").delete().eq("event_code", eventCode);
      if (databaseError) throw databaseError;
      await loadCloudPhotos();
      await updateStorageUsage();
    } else {
      for (const photo of eventPhotos) await deleteLocalPhoto(photo.id);
      photos = photos.filter(photo => photo.eventCode !== eventCode);
    }
    selectedAdminEventCode = "";
    render();
    toast(`Box "${eventName}" eliminata`);
  } catch (error) {
    toast(error.message || "Eliminazione della box non riuscita");
  }
}

function render() {
  const query = $("searchInput").value.toLowerCase();
  if (isAdmin && !clientMode) {
    renderAdminArchive(query);
    renderEventLinks();
    return;
  }
  const allowedPhotos = requestedEventCode && !isAdmin ? photos.filter(p => p.eventCode === requestedEventCode) : photos;
  if (clientMode) {
    $("clientGalleryHead").classList.remove("hidden");
    $("clientEventName").textContent = allowedPhotos[0]?.event || "Le tue fotografie";
    document.title = `${allowedPhotos[0]?.event || "Galleria evento"} — ${branding.companyName}`;
  }
  const events = [...new Set(allowedPhotos.map(p => p.event))];
  $("filters").innerHTML = ["Tutti", ...events].map(x => `<button class="${x === selectedFilter ? "active" : ""}" data-filter="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("");
  const visible = allowedPhotos.filter(p => (clientMode || selectedFilter === "Tutti" || p.event === selectedFilter) && (clientMode || `${p.event} ${p.date}`.toLowerCase().includes(query)));
  grid.classList.remove("admin-box-grid");
  grid.innerHTML = photoCardsMarkup(visible);
  $("emptyState").classList.toggle("hidden", visible.length > 0);
  bindPhotoGridActions();
  renderEventLinks();
}

function photoCardsMarkup(items) {
  const content = [];
  items.forEach((p, i) => {
    content.push(`
    <article class="photo-card ${clientMode ? "client-photo-card" : ""}">
      <div class="polaroid">
        ${isAdmin && !p.sample ? `<button class="delete-button" data-delete="${p.id}" aria-label="Elimina">×</button>` : ""}
        <img src="${p.url}" alt="${escapeHtml(p.event)}" loading="${i < 2 ? "eager" : "lazy"}">
        <div class="photo-info ${clientMode ? "client-photo-info" : ""}">
          ${clientMode ? "" : `<div><h3>${escapeHtml(p.event)}</h3><p>${formatDate(p.date)}${isAdmin && !p.sample ? ` · <strong>${p.downloads || 0} download</strong>` : ""}</p></div>`}
          ${clientMode ? `<span class="download-hint">Scarica la tua foto <span aria-hidden="true">→</span></span>` : ""}
          <button class="download-button" data-download="${p.id}" aria-label="Scarica foto">↓</button>
        </div>
      </div>
    </article>`);
  });
  return content.join("");
}

function bindPhotoGridActions() {
  grid.querySelectorAll("[data-download]").forEach(b => b.onclick = () => downloadPhoto(b.dataset.download));
  grid.querySelectorAll("[data-delete]").forEach(b => b.onclick = () => removePhoto(b.dataset.delete));
}

function renderAdminArchive(query) {
  const realPhotos = photos.filter(photo => !photo.sample && photo.eventCode);
  const filters = $("filters");
  const searchBox = $("searchBox");
  if (selectedAdminEventCode) {
    const eventPhotos = realPhotos.filter(photo => photo.eventCode === selectedAdminEventCode);
    if (!eventPhotos.length) {
      selectedAdminEventCode = "";
      renderAdminArchive(query);
      return;
    }
    const event = eventPhotos[0];
    $("galleryEyebrow").textContent = "MODIFICA BOX";
    $("galleryTitle").textContent = event.event;
    searchBox.classList.add("hidden");
    filters.className = "filters admin-box-toolbar";
    filters.innerHTML = `
      <button type="button" id="backToBoxes">← Tutte le box</button>
      <button type="button" id="addToOpenBox">＋ Aggiungi foto</button>
      <button type="button" id="copyOpenBoxLink">Copia link cliente</button>
      <button type="button" class="delete-event-button" id="deleteOpenBox">Elimina intera box</button>
    `;
    grid.classList.remove("admin-box-grid");
    grid.innerHTML = photoCardsMarkup(eventPhotos);
    $("emptyState").classList.add("hidden");
    bindPhotoGridActions();
    $("backToBoxes").onclick = () => {
      selectedAdminEventCode = "";
      render();
    };
    $("addToOpenBox").onclick = () => {
      pendingEventCode = selectedAdminEventCode;
      $("addFilesInput").click();
    };
    $("copyOpenBoxLink").onclick = () => copyEventLink(buildEventLink(selectedAdminEventCode));
    $("deleteOpenBox").onclick = () => removeEventBox(selectedAdminEventCode);
    return;
  }

  $("galleryEyebrow").textContent = "ARCHIVIO EVENTI";
  $("galleryTitle").textContent = "Le tue box";
  searchBox.classList.remove("hidden");
  $("searchInput").placeholder = "Cerca una box…";
  filters.className = "filters hidden";
  const boxes = new Map();
  realPhotos.forEach(photo => {
    if (!boxes.has(photo.eventCode)) {
      boxes.set(photo.eventCode, {
        name: photo.event,
        date: photo.date,
        cover: photo.url,
        count: 0,
        downloads: 0
      });
    }
    const box = boxes.get(photo.eventCode);
    box.count += 1;
    box.downloads += photo.downloads || 0;
  });
  const matchingBoxes = [...boxes].filter(([, box]) => `${box.name} ${box.date}`.toLowerCase().includes(query));
  grid.classList.add("admin-box-grid");
  grid.innerHTML = matchingBoxes.map(([code, box]) => `
    <button class="admin-event-box" type="button" data-open-admin-event="${code}">
      <img src="${box.cover}" alt="">
      <span class="admin-event-box-copy">
        <strong>${escapeHtml(box.name)}</strong>
        <small>${formatDate(box.date)} · ${box.count} foto · ${box.downloads} download</small>
        <span>Apri e modifica <b>→</b></span>
      </span>
    </button>
  `).join("");
  $("emptyState").classList.toggle("hidden", matchingBoxes.length > 0);
  grid.querySelectorAll("[data-open-admin-event]").forEach(button => {
    button.onclick = () => {
      selectedAdminEventCode = button.dataset.openAdminEvent;
      render();
      $("galleria").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
}

function renderEventLinks() {
  const container = $("eventLinks");
  if (!container || !isAdmin) return;
  const boxes = new Map();
  photos.filter(p => !p.sample && p.eventCode).forEach(p => {
    if (!boxes.has(p.eventCode)) boxes.set(p.eventCode, { name: p.event, date: p.date, count: 0, downloads: 0 });
    boxes.get(p.eventCode).count += 1;
    boxes.get(p.eventCode).downloads += p.downloads || 0;
  });
  if (!boxes.size) {
    container.innerHTML = `<p class="no-events">Crea la prima box caricando le fotografie.</p>`;
    return;
  }
  container.innerHTML = [...boxes].map(([code, box]) => `
    <article class="event-link-card">
      <div>
        <strong>${escapeHtml(box.name)}</strong>
        <small>${formatDate(box.date)} · ${box.count} foto · ${box.downloads} download</small>
      </div>
      <div class="event-actions">
        <button type="button" data-add-event="${code}">Aggiungi foto</button>
        <button type="button" data-copy-event="${code}">Copia link</button>
        <a href="${buildEventLink(code)}" target="_blank" aria-label="Apri box">↗</a>
      </div>
    </article>
  `).join("");
  container.querySelectorAll("[data-copy-event]").forEach(button => {
    button.onclick = () => copyEventLink(buildEventLink(button.dataset.copyEvent));
  });
  container.querySelectorAll("[data-add-event]").forEach(button => {
    button.onclick = () => {
      pendingEventCode = button.dataset.addEvent;
      $("addFilesInput").click();
    };
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
  await recordDownload(p);
  try {
    const downloadUrl = p.originalUrl || p.url;
    const response = await fetch(downloadUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const extension = String(p.path || p.name || "foto.jpg").split(".").pop().replace(/[^a-z0-9]/gi, "") || "jpg";
    const a = document.createElement("a"); a.href = url; a.download = `${p.event.replace(/\s+/g, "-")}-${p.date}.${extension}`; a.click();
    URL.revokeObjectURL(url);
    toast("Download avviato");
  } catch {
    window.open(p.originalUrl || p.url, "_blank");
  }
}

async function recordDownload(photo) {
  if (!cloudEnabled || !supabase || photo.sample) return;
  const { data, error } = await supabase.rpc("increment_photo_download", {
    target_photo_id: photo.id,
    target_event_code: photo.eventCode
  });
  if (!error) {
    photo.downloads = Number(data || photo.downloads + 1);
    if (isAdmin) render();
  }
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
