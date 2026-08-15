# Polaroid

Galleria fotografica responsive con:

- area cliente dedicata a ogni evento;
- fotografie ottimizzate per telefono e originali ad alta qualità al download;
- area amministratore con account persistente, profilo e personalizzazione;
- caricamento, aggiunta e cancellazione di foto e intere box;
- contatori di visite, download e tempo medio;
- fotografie su ImageKit;
- dati e accesso su Cloudflare Workers + D1;
- pubblicazione del sito con GitHub Pages.

## Servizi collegati

- Sito: `https://setteandrea46-gif.github.io/polaroid-studio/`
- API: `https://polaroid-api.setteandrea46.workers.dev`
- Archivio immagini: ImageKit, cartella `Polaroid`

La chiave privata ImageKit è conservata esclusivamente come secret del Worker
Cloudflare e non deve essere inserita nei file pubblicati su GitHub.
