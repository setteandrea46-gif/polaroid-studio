# Polaroid Studio

Galleria fotografica responsive con:

- area pubblica per cercare e scaricare fotografie;
- area amministratore per caricare ed eliminare foto;
- accesso amministratore tramite un unico link personale, senza password;
- una box e un link cliente diverso per ogni evento;
- modalità demo locale pronta all'uso, con archivio IndexedDB adatto anche a più fotografie;
- modalità cloud con Supabase per condividere le foto tra tutti i dispositivi.

## Prova locale

Apri `index.html` nel browser per visualizzare la galleria dimostrativa. L’accesso amministratore si attiva collegando Supabase.

## Attivazione online

1. Crea un progetto gratuito su Supabase.
2. Apri SQL Editor, incolla il contenuto di `supabase.sql` e premi Run.
3. Genera una chiave personale lunga e salva soltanto il suo hash SHA-256 nella tabella `admin_settings`.
4. In Project Settings > API copia Project URL e anon public key.
5. Inseriscili in `config.js`.
6. Pubblica questi file con GitHub Pages.
7. Apri il link personale `#admin=CHIAVE_PERSONALE` una volta su ogni dispositivo.

La chiave completa resta soltanto nel link privato e nel dispositivo dell’amministratore: non viene pubblicata su GitHub né salvata in chiaro nel database.
