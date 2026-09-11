# TorunaManager

Webapp client-side e locale-first per progettare e gestire tornei sportivi,
con un preset operativo pensato per la pallavolo.

## Funzioni incluse nell'MVP

- importazione delle squadre tramite copia-incolla;
- editor completo delle fasi, con gironi per livello o incrociati e qualificazione automatica o configurabile;
- gironi all’italiana ed eliminazione diretta;
- tornei S3 e 6 contro 6, con stime temporali specifiche per il ritmo di gioco;
- stima della durata in base al punteggio di ogni set, ai campi condivisi e alla pausa configurabile tra le fasi;
- gestione coordinata di fino a tre sotto-tornei sugli stessi campi;
- generazione degli incontri dei gironi e del tabellone a eliminazione diretta;
- assegnazione automatica a campi e orari;
- regia live unificata, con blocco delle sovrapposizioni sui campi;
- risultati per set e classifiche con punti, quoziente set e punti;
- salvataggio automatico nel browser;
- 24 squadre dimostrative caricate soltanto in modalità sviluppo.

## Avvio

```bash
npm install
npm run dev
```

## Verifiche

```bash
npm test
npm run build
```

## Ripristino della sessione Codex

Il file `codex_session.txt` contiene il comando per riprendere la sessione di
sviluppo dalla directory di questo progetto.
