# TournaManager

Webapp client-side e locale-first per progettare e gestire tornei sportivi,
con un preset operativo pensato per la pallavolo.

## Funzioni incluse nell'MVP

- importazione delle squadre tramite copia-incolla;
- editor completo delle fasi, con gironi per livello o incrociati e qualificazione automatica o configurabile;
- gironi all’italiana con sola andata o andata e ritorno, ed eliminazione diretta;
- tornei S3 Red, Green e White oppure 6 contro 6, con stime temporali specifiche per categoria e ritmo di gioco;
- stima della durata in base al punteggio di ogni set, ai campi condivisi e alla pausa configurabile tra le fasi;
- gestione coordinata di più tornei paralleli sugli stessi campi;
- generazione degli incontri dei gironi e del tabellone a eliminazione diretta;
- assegnazione automatica a campi e orari;
- regia live unificata, con blocco delle sovrapposizioni sui campi;
- risultati per set e classifiche con punti, quoziente set e punti;
- salvataggio automatico nel browser;
- importazione ed esportazione della configurazione in formato JSON;
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

## Pubblicazione con GitHub Pages

Genera il sito statico nella cartella `docs`:

```bash
npm run build:pages
```

Poi pubblica sul repository anche la cartella `docs`. Nelle impostazioni GitHub
del repository apri **Settings → Pages** e configura:

- **Source**: `Deploy from a branch`;
- **Branch**: il branch pubblicato (normalmente `main`);
- **Folder**: `/docs`.

I percorsi degli asset sono relativi, quindi il sito funziona sia su un dominio
GitHub Pages principale sia nel sottopercorso con il nome del repository. Il file
`.nojekyll` viene incluso automaticamente nella build.


## Dominio pubblico

Sito: https://tournamanager.davidaffo.com/

GitHub Pages pubblica dal branch `master`, cartella `/docs`, con Custom domain `tournamanager.davidaffo.com`. Il file `public/CNAME` conserva il dominio anche dopo una nuova build.

Su Cloudflare usare un CNAME `tournamanager` verso `davidaffo.github.io`, in modalità DNS only. Abilitare Enforce HTTPS su GitHub quando il certificato è disponibile. I percorsi relativi degli asset supportano la radice del nuovo dominio.

Il nuovo sottodominio ha un archivio del browser separato. I dati del vecchio indirizzo non migrano automaticamente: esportare quelli ancora disponibili e importarli dalla nuova app, quando la funzione è disponibile. Per usare il nuovo indirizzo come PWA, installare l’app dal nuovo dominio.
