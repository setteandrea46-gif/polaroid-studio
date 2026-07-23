# Polaroid Studio

Galleria fotografica responsive con:

- area pubblica per cercare e scaricare fotografie;
- area amministratore per caricare ed eliminare foto;
- modalità demo locale pronta all'uso;
- modalità cloud con Supabase per condividere le foto tra tutti i dispositivi.

## Prova locale

Apri `index.html` nel browser. Premi **Area amministratore** e poi **Entra nella demo amministratore**.

## Attivazione online

1. Crea un progetto gratuito su Supabase.
2. Apri SQL Editor, incolla il contenuto di `supabase.sql` e premi Run.
3. In Authentication > Users crea l'utente amministratore con email e password.
4. In Project Settings > API copia Project URL e anon public key.
5. Inseriscili in `config.js`.
6. Pubblica questi file con GitHub Pages.

La password non viene mai salvata nel sito: l'accesso è gestito da Supabase.
