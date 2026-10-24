# Manuale di Tag Fixer

Tag Fixer legge e corregge in batch i metadati dei file audio: **tag ID3 e copertine sugli MP3** (ID3v2.2, v2.3 e v2.4), **`bext` BWF con la sua CodingHistory, iXML e cart (AES46) su WAV e BWF, anche RF64/BW64**, e **commenti Vorbis sui FLAC**. Lavori in una tabella in stile foglio di calcolo, ogni file viene copiato di sicurezza prima di essere toccato e l'ultimo batch si ripristina in un solo passo. È un'app desktop gratuita per Windows, macOS e Linux di OnAir Garage.

## Installazione e primo avvio

Scarica l'installer per il tuo sistema dalla pagina [Releases](https://github.com/djgragra/tag-fixer/releases) e controllalo con `SHA256SUMS.txt`:
`Tag-Fixer-Setup-<V>.exe` (Windows), `Tag-Fixer-<V>-arm64.dmg` (Mac con Apple silicon), `Tag-Fixer-<V>-x64.dmg` (Mac con Intel), `Tag-Fixer-<V>.AppImage` (Linux).
L'app è gratuita e non ha un certificato Apple o Microsoft, quindi al primo avvio può comparire un avviso.

- **Windows**: avvia l'installer. Se SmartScreen dice «Windows ha protetto il PC», clicca *Ulteriori informazioni* → *Esegui comunque*.
- **macOS**: apri l'immagine disco e trascina l'app in Applicazioni. L'app è firmata ad-hoc, ed è ciò che serve a un Mac Apple silicon per aprirla. Il primo avvio mostra comunque l'avviso «sviluppatore non identificato»: apri *Impostazioni di Sistema → Privacy e sicurezza*, scorri in basso e clicca *Apri comunque* (il clic destro → Apri non esiste più da macOS 15). Se una versione precedente (26.10.3 o più vecchia) dice che l'app è «danneggiata», esegui una volta nel Terminale: `xattr -cr "/Applications/Tag Fixer.app" && codesign --force --deep -s - "/Applications/Tag Fixer.app"`
- **Linux**: rendi eseguibile l'AppImage (`chmod +x Tag-Fixer-*.AppImage`) e avviala.

L'app si apre sempre in inglese; scegli Italiano o Español dal menu della lingua e la scelta viene ricordata. Il tema può essere chiaro, scuro o seguire il sistema.

## La finestra

Trascina file audio o cartelle sulla finestra, oppure usa *Aggiungi file…* e *Aggiungi cartella…* (*Includi sottocartelle* va più in profondità). I file vanno nella loro scheda:

| Scheda | File | Cosa modifichi |
|---|---|---|
| MP3 · ID3 | MP3 | Titolo, Artista, Album, Anno, Traccia, Genere, Commento e Copertina |
| WAV · BWF | WAV e BWF, anche RF64/BW64 | Tre viste: **BWF** (Description, Originator, Rif. originator, Data, Ora e Coding history), **iXML** (Progetto, Scena, Nastro, Take, Note) e **Cart** (Titolo, Artista, Cut ID, Client ID, Categoria, Classificazione, Out cue, data e ora di inizio e di fine, Definito dall'utente) |
| FLAC | FLAC | Titolo, Artista, Album, Data, Traccia, Genere e Commento (commenti Vorbis) |

Ogni riga mostra una casella, il file, il suo stato e le info del file, poi i campi. Una pillola in alto dice quanti file ci sono nell'elenco, quanti sono da salvare e quanti hanno errori.

## Modificare

1. **Clicca una cella e scrivi.** Le celle modificate sono evidenziate e quelle non valide (per esempio una data che non esiste) diventano rosse. Invio e frecce passano da una riga all'altra; Esc rimette la cella com'era.
2. **Lo stesso valore in molti file**: scrivilo nella riga evidenziata sotto le intestazioni (*Imposta su tutte le righe spuntate*) e premi ⇣: viene scritto in ogni riga spuntata di questa scheda.
3. **Deseleziona** i file che non vuoi cambiare. Le righe rosse bloccano il salvataggio finché non le correggi o le deselezioni.
4. **Annulla e ripristina** ogni modifica e ogni strumento con Ctrl+Z e Ctrl+Y (⌘Z su Mac), oppure con i pulsanti *Annulla* e *Ripristina*. *Scarta modifiche* butta via tutto ciò che non è stato salvato.
5. Un file danneggiato o tagliato, o con un tag che non si può leggere in sicurezza, viene mostrato in **sola lettura** con il motivo e non viene mai scritto.

## Gli strumenti sopra la tabella

Ogni strumento cambia solo la tabella: nei file non viene scritto nulla finché non salvi.

- **Pattern…**: *Riempi un campo da un pattern* (per esempio `{artist} - {title}` o `{n:3}`, con filtri come `{filename|lower}`; il contatore parte da dove dici), *Leggi i campi dal nome del file*, oppure *Rinomina i file dai tag*. I pattern salvati (*Pattern salvati…*) stanno nelle impostazioni e viaggiano con il backup della configurazione. La finestra mostra cosa otterrebbe ogni file prima che tu applichi.
- **Trova e sostituisci…**: su un campo o su tutti i campi della vista. Trova e sostituisci testo (testo semplice o *Espressione regolare*, *Parola intera*, *Maiuscole/minuscole*), oppure pulisci: togli gli spazi agli estremi, riduci gli spazi ripetuti, MAIUSCOLO, minuscolo, Iniziali Maiuscole, Maiuscola solo all'inizio, togli gli accenti, converti in ASCII. La finestra dice quante celle cambierebbero.
- **Data e ora dal file…**: riempie la data e l'ora di origine BWF, oppure l'inizio o la fine cart, dal nome del file (per esempio `2026-10-13_0830…`, altrimenti la data di modifica), dalla data di modifica o dalla data di creazione. *Imposta anche l'ora* è facoltativo.
- **Coding history…** (WAV): modificala in un file, oppure sostituiscila o aggiungi una riga in fondo a tutti i file spuntati.
- **Copertina…** (MP3): scegli un'immagine JPEG o PNG (fino a 16 MB) e usala per questo file o per tutti i file spuntati, oppure togli l'immagine. L'immagine diventa la copertina frontale e le altre immagini del tag restano; *Togli* cancella tutte le immagini del tag.
- **Controlla i file…**: elenca ciò che sembra sbagliato, per livello (Errori, Avvisi, Note): campi mancanti, valori non validi, date nel futuro, doppioni e file danneggiati. Clicca una riga per andare al file; *Mostra solo questi file* filtra la tabella.
- **Esporta CSV…** / **Importa CSV…**: esporta la tabella (i file spuntati o tutti i file della scheda) e reimportala, con il separatore che scegli. Le righe vengono abbinate per percorso completo o per nome di file univoco; una cella vuota lascia stare il campo, a meno che tu non spunti *Una cella vuota svuota il campo*.
- **Converti in ASCII**: il testo nei campi `bext` e cart dovrebbe essere ASCII (lo dice la specifica). Il testo non ASCII viene segnalato, e questo pulsante trasforma `è` in `e` e mostra il risultato prima del salvataggio.

## Salvataggio, backup e ripristino

1. Premi **Salva…**. La finestra elenca le modifiche, la **cartella di backup** e lo spazio libero necessario; conferma per andare avanti.
2. Ogni originale viene copiato, con la sua data di modifica, nella cartella di backup prima di qualsiasi cambiamento. Una modifica che mantiene la dimensione del file viene scritta sul posto; le altre passano da un file temporaneo che sostituisce l'originale solo quando è completo e verificato. Ogni file viene riletto e confrontato; se qualcosa non va, l'originale viene rimesso. I batch che rinominano soltanto non hanno bisogno di copia di sicurezza.
3. Alla fine la finestra dice quanti file sono stati salvati e dove sono gli originali.
4. **Ripristina ultimo batch** rimette i tag e i nomi originali dalla copia di sicurezza (i file modificati di nuovo da allora restano come sono).

Cambiare la history, qualsiasi testo iXML o aggiungere un chunk **riscrive il file**: richiede tempo e, per il backup, tanto spazio libero quanto il file. L'app controlla lo spazio libero prima di salvare. Tieni la cartella di backup fuori dalle cartelle di playout o musica: un backup dentro una libreria monitorata potrebbe essere caricato come duplicato.

## Impostazioni

Le impostazioni sono in schede, nello stesso ordine di ogni app OnAir Garage:

| Scheda | Contenuto |
|---|---|
| Generale | Lingua, tema, la **cartella dei backup** dei file modificati (*Cambia…*, *Apri cartella*) e per quanti giorni conservare i file di log |
| Aggiornamenti | L'aggiornamento guidato (vedi sotto) |
| Backup | Esportazione e importazione di impostazioni e pattern salvati (`tag-fixer-backup-AAAA-MM-GG.json`); l'app non conserva password né token, quindi il file non ne contiene |
| Aiuto e informazioni | Versione, licenza, crediti, link, *Copia info per l'assistenza* (versione, sistema, lingua, ultimo controllo aggiornamenti e ultimo errore: mai nomi di file né impostazioni), *Apri cartella dei log* e il riquadro mancia con il salvadanaio |

Il riquadro mancia ha un salvadanaio e un pulsante: entrambi aprono la pagina di sostegno del sito nella lingua dell'app; dentro l'app non viene mai chiesto nulla. Tutto avviene sul tuo computer: l'app contatta GitHub solo per cercare aggiornamenti, quando è attivo, e per scaricare un aggiornamento che chiedi.

## Aggiornamenti

Tag Fixer cerca una nuova versione 15 secondi dopo l'avvio e poi ogni 24 ore (puoi disattivarlo in *Impostazioni → Aggiornamenti*). Un avviso offre *Scarica e installa* (con una barra di avanzamento e *Annulla*), *Ricordamelo dopo* (24 ore) e *Salta questa versione*. Il file viene controllato con lo SHA-256 della release (`SHA256SUMS.txt`); uno che non corrisponde viene eliminato. *Chiudi e installa* salva prima una copia di sicurezza delle impostazioni. Dopo l'aggiornamento compare una volta la finestra *Novità*. Niente viene scaricato né installato senza un clic.

## Limiti e sicurezza

- I file WAV danneggiati o tagliati, un'intestazione RF64 o un chunk `ds64` non validi, i tag ID3 con desincronizzazione o compressi, i tag con dati illeggibili e i metadati FLAC danneggiati vengono mostrati in sola lettura e non vengono mai scritti.
- Un frame di testo, un commento o un campo Vorbis con più valori viene mostrato unito da ` / ` e sostituito da un solo valore se modificato. Gli altri commenti e i frame personalizzati restano come sono.
- iXML: se il testo non è UTF-8, non è XML valido o l'elemento che modifichi contiene elementi annidati, quel campo è in sola lettura. cart: il chunk deve avere la sua parte fissa di 2048 byte, altrimenti è in sola lettura.
- Non supportati: OGG, M4A, AIFF e altri formati. Non toccati: l'audio, ID3v1, RIFF `LIST`/INFO, `axml`, altri chunk e le immagini dei FLAC.
- La data di modifica di un file salvato è il momento del salvataggio; il ripristino rimette la data originale.
- Non è uno strumento certificato: leggi sempre l'elenco delle modifiche prima di salvare.

## Risoluzione dei problemi

| Problema | Cosa fare |
|---|---|
| macOS: «l'app è danneggiata / non può essere aperta» | Apri *Impostazioni di Sistema → Privacy e sicurezza → Apri comunque*; per una versione precedente alla 26.10.4, esegui nel Terminale `xattr -cr "/Applications/Tag Fixer.app" && codesign --force --deep -s - "/Applications/Tag Fixer.app"`. |
| Windows: «Windows ha protetto il PC» | *Ulteriori informazioni* → *Esegui comunque*. |
| Linux: l'AppImage non si avvia | Rendila eseguibile (`chmod +x`) e installa FUSE (`libfuse2`) se il tuo sistema lo richiede. |
| Una cella è in sola lettura | Guarda lo stato del file: il file è danneggiato o ha una parte che l'app non può scrivere in sicurezza. |
| Spazio insufficiente per salvare | Libera spazio su disco o cambia la cartella di backup in *Impostazioni → Generale*. |
| Una modifica è andata male | *Ripristina ultimo batch* rimette i file originali dalla cartella di backup. |
| Il download dell'aggiornamento è fallito con «checksum mismatch» | Il file è stato eliminato automaticamente. Riprova, oppure scarica l'installer a mano dalla pagina delle release. |

## Contatti

Graziano Melzi · OnAir Garage — `https://onairgarage.com` — `hello@onairgarage.com`. Pagina dello strumento: `https://onairgarage.com/tools/tag-fixer/`. Codice sorgente e release: `https://github.com/djgragra/tag-fixer`. Licenza: MIT © 2026 Graziano Melzi.
