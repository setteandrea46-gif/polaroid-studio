# Polaroid Studio

Galleria fotografica responsive con:

- area pubblica per cercare e scaricare fotografie;
- area amministratore per caricare ed eliminare foto;
- accesso amministratore tramite e-mail e password;
- registrazione con conferma dell'indirizzo e-mail;
- una box e un link cliente diverso per ogni evento;
- modalità demo locale pronta all'uso, con archivio IndexedDB adatto anche a più fotografie;
- modalità cloud con Supabase per condividere le foto tra tutti i dispositivi.

## Prova locale

Apri `index.html` nel browser per visualizzare la galleria dimostrativa. L’accesso amministratore si attiva collegando Supabase: le credenziali non devono essere salvate nei file pubblici del sito.

## Attivazione online

1. Crea un progetto gratuito su Supabase.
2. Apri SQL Editor, incolla il contenuto di `supabase.sql` e premi Run.
3. In Authentication > Users crea l'utente amministratore con email e password.
4. Abilita l'account nella tabella `admins` usando l'istruzione indicata in fondo a `supabase.sql`.
5. In Project Settings > API copia Project URL e anon public key.
6. Inseriscili in `config.js`.
7. Pubblica questi file con GitHub Pages.

La password non viene mai salvata nel sito: l'accesso è gestito da Supabase.
