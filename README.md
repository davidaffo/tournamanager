# TorunaManager

Webapp client-side e locale-first per progettare e gestire tornei sportivi,
con un preset operativo pensato per la pallavolo.

## Funzioni incluse nell'MVP

- importazione delle squadre tramite copia-incolla;
- configurazione del numero di gironi e delle squadre qualificate;
- gironi all’italiana ed eliminazione diretta;
- tornei S3 e 6 contro 6, con stime temporali specifiche per il ritmo di gioco;
- stima della durata in base a set e punti, con pausa configurabile tra le fasi;
- generazione degli incontri dei gironi e del tabellone a eliminazione diretta;
- assegnazione automatica a campi e orari;
- regia live con avvio e conclusione delle gare;
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
