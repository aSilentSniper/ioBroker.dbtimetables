# ioBroker.dbtimetables (Deutsch)

> Dies ist die deutsche Langfassung der Dokumentation. Die offizielle, für den ioBroker-Adapter-Checker
> maßgebliche Version ist die englische [README.md](../../README.md) im Projekt-Root.

Abfahrtstafel-Adapter auf Basis der **offiziellen Deutsche Bahn Timetables API** (IRIS) vom
[DB API Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables),
als Ersatz für den HAFAS-basierten [ioBroker.fahrplan](https://github.com/gaudes/ioBroker.fahrplan) für den
Anwendungsfall "Abfahrtstafel für eine Station".

> Unterschied zum alten Adapter: HAFAS liefert fertige Verbindungen inkl. Echtzeit in einem Aufruf.
> Die Timetables-API liefert nur den rohen Sollfahrplan (`plan`) und separat die aktuellen Änderungen
> (`fchg`/`rchg`), die zusammengeführt werden müssen. Das übernimmt dieser Adapter für dich.

## 1. Zugangsdaten (Client-ID / API-Key) besorgen

1. Auf [developers.deutschebahn.com](https://developers.deutschebahn.com/db-api-marketplace/apis/product) registrieren bzw. anmelden.
2. Im Bereich **Anwendungen** eine neue Anwendung anlegen (nur ein Name ist Pflicht, z.B. "ioBroker").
3. Zur Produktseite **[Timetables](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables)** gehen und **Abonnieren** klicken.
4. Nutzungsplan **Free** wählen (60 Aufrufe/Minute, kostenlos), die zuvor angelegte Anwendung auswählen, mit **Weiter** und **Fertig** abschließen.
5. In der Anwendungsübersicht stehen jetzt **Client ID** und **Client Secret** (= API-Key). Beides in die Adapterkonfiguration eintragen.

## 2. EVA-Nummer der Station herausfinden

Die API kennt Stationen nur über ihre 7-stellige **EVA-Nummer**, nicht über den Namen. Kein curl mehr nötig:

**Direkt in der Instanzkonfiguration (empfohlen):**

Im Tab "Abfahrtstafeln" gibt es dafür eine eigene Suche (ein selbstgebautes Admin-8-Custom-Widget, Quellcode
unter `src-admin/`): Stationsnamen eintippen, "Suchen" klicken, Treffer per Klick zur Stationsliste darunter
hinzufügen - fertig. Die komplette Stationsverwaltung (hinzufügen, bearbeiten, löschen, aktivieren) läuft in
diesem einen Widget statt in einer klassischen jsonConfig-Tabelle.

Voraussetzung: Die Adapterinstanz läuft bereits mit gültigem Client-Id/Api-Key (die Suche fragt die
laufende Instanz per `sendTo` ab) **und Admin ist Version 8 oder neuer** - das Widget nutzt die neue,
React-basierte Custom-Component-API von Admin 8 (Module Federation, `guiApi: 2`). Ist die Instanz nicht
aktiv oder sind die Zugangsdaten noch nicht gespeichert, kommt eine Fehlermeldung im Widget - die
EVA-Nummer kann dann trotzdem manuell in der Stationsliste eingetragen werden.

**Alternativ per curl** (z.B. wenn die Instanz noch nicht läuft):

```bash
curl -H "DB-Client-Id: DEINE_CLIENT_ID" -H "DB-Api-Key: DEIN_API_KEY" \
  "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/station/Karlsruhe"
```

Antwort z.B.:

```xml
<stations>
  <station name="Karlsruhe Hbf" eva="8000191" ds100="RK"/>
  <station name="Karlsruhe West" eva="8007433" ds100="RKW"/>
</stations>
```

Die `eva`-Nummer (hier `8000191`) trägst du in die Stationentabelle ein.

**Alternativ per ioBroker-Skript / sendTo**, sobald der Adapter läuft und Zugangsdaten hinterlegt sind:

```js
sendTo('dbtimetables.0', 'searchStation', { pattern: 'Karlsruhe' }, (res) => {
    // res ist ein Array von { value: eva, label: "Name (eva, ds100)" }
    console.log(JSON.stringify(res));
});
```

## 3. Installation

Solange dieser Adapter noch nicht im offiziellen ioBroker-Repository gelistet ist, installierst du ihn
über die Admin-Oberfläche unter **Adapter → Eigenen Adapter installieren**, indem du den entpackten
Ordnerpfad oder eine Git-URL angibst (falls das Projekt in einem eigenen Repository liegt).

## 4. Konfiguration

**Tab "Zugangsdaten"**

| Feld | Beschreibung |
|---|---|
| DB-Client-Id / DB-Api-Key | siehe Schritt 1 |
| Aktualisierungsintervall | wie oft neu abgefragt wird (Sekunden). Pro Durchlauf verbraucht jede Station 2-5 API-Aufrufe (1x Changes + 1-4x Plan-Stundenslices). Beim Free-Plan (60/min) reichen bei wenigen Stationen auch 30-60s. |
| Verspätet markieren ab | ab wie vielen Minuten Verspätung eine Abfahrt als "delayed" markiert wird (Standard 2, wie beim alten Adapter) |

**Tab "Abfahrtstafeln"** – Suche (siehe Schritt 2) plus eine Zeile pro gewünschter Station:

| Feld | Beschreibung |
|---|---|
| Aktiv | Zeile aktiv/inaktiv |
| Name | frei wählbarer Name, wird zum Objekt-Ordnernamen (`stations.<Name>`) |
| EVA-Nummer | siehe Schritt 2 |
| Anzahl Abfahrten | wie viele nächste Abfahrten abgerufen werden |
| Zeit-Offset (Min.) | Abfahrten erst ab jetzt+N Minuten anzeigen (Pendant zu "Zeit-Offset" beim alten Adapter), Standard 0 |
| Kategorie-Filter | optional, z.B. `S,RE,RB` um nur bestimmte Zuggattungen zu zeigen; leer = alle |

## 5. Objektbaum – kompatibel zu ioBroker.fahrplan (nur Abfahrtstafeln)

Das Objektschema für die Abfahrtstafeln-Funktion wurde bewusst identisch zum tatsächlichen Quellcode von
`ioBroker.fahrplan` (`lib/deptt.js`, `lib/depttdep.js`, `lib/line.js`, `lib/station.js`) nachgebaut, damit
bestehende VIS-Bindings/Skripte im Idealfall nur den Instanznamen (`fahrplan.0` → `dbtimetables.0`) austauschen müssen.

```
dbtimetables.0.DepartureTimetable<N>.Enabled                     bool - wird auch für deaktivierte Zeilen geschrieben
dbtimetables.0.DepartureTimetable<N>.Station.Name                Stationsname
dbtimetables.0.DepartureTimetable<N>.Station.eBhf                Stations-ID (bei uns: EVA-Nummer)
dbtimetables.0.DepartureTimetable<N>.Station.CustomName           frei vergebener Name
dbtimetables.0.DepartureTimetable<N>.Station.Type                 fix "station"
dbtimetables.0.DepartureTimetable<N>.Station.JSON
dbtimetables.0.DepartureTimetable<N>.JSON                         komplette Abfahrtenliste als JSON
dbtimetables.0.DepartureTimetable<N>.HTML                         fertige HTML-Tabelle (Spalten: Zeit/Richtung/Plattform/Verspätung/Typ, wie im Original)
dbtimetables.0.DepartureTimetable<N>.<i>.JSON                     Einzelabfahrt als JSON
dbtimetables.0.DepartureTimetable<N>.<i>.Departure                 Ist-Abfahrt, ms-Timestamp (wie im Original)
dbtimetables.0.DepartureTimetable<N>.<i>.DeparturePlanned           Plan-Abfahrt, ms-Timestamp
dbtimetables.0.DepartureTimetable<N>.<i>.DepartureDelaySeconds      Verspätung in Sekunden
dbtimetables.0.DepartureTimetable<N>.<i>.DepartureOnTime            bool (nur bei exakt 0 Verspätung true - Quirk des Originals bewusst übernommen)
dbtimetables.0.DepartureTimetable<N>.<i>.DepartureDelayed           bool (erst ab Schwellwert true)
dbtimetables.0.DepartureTimetable<N>.<i>.Name                      Linienname, z.B. "ICE 273"
dbtimetables.0.DepartureTimetable<N>.<i>.Direction                 Fahrtziel
dbtimetables.0.DepartureTimetable<N>.<i>.Mode                      grobe Näherung "train"/"bus"/"tram" (IRIS kennt HAFAS' "mode" nicht)
dbtimetables.0.DepartureTimetable<N>.<i>.Operator                  numerischer EVU-Code (IRIS liefert keinen Klarnamen wie HAFAS)
dbtimetables.0.DepartureTimetable<N>.<i>.Product                   Zuggattung (ICE/RE/RB/S/...), Ersatz für HAFAS-Produkt-ID
dbtimetables.0.DepartureTimetable<N>.<i>.Platform                  aktuelles Gleis
dbtimetables.0.DepartureTimetable<N>.<i>.PlannedPlatform            geplantes Gleis
dbtimetables.0.DepartureTimetable<N>.<i>.Cancelled                  ZUSATZFELD, gab es im Original nicht (IRIS liefert Ausfälle, HAFAS-Version der Abfahrtstafel nicht)
```

**Was NICHT automatisch kompatibel ist:**
- **Instanzname** bleibt zwangsläufig anders (`dbtimetables.0` statt `fahrplan.0`) – zwei verschiedene Adapter können
  keinen identischen Objektpfad-Präfix haben. Jede Bindung/jedes Skript muss also mindestens den Instanznamen anpassen.
- **Konfiguration** wird nicht automatisch übernommen (andere `native`-Struktur) – die Stationstabelle muss manuell neu
  angelegt werden. Gute Nachricht: die `station_from`-ID aus dem alten Adapter ist bei echten DB-Bahnhöfen über die
  DB-HAFAS-Anbindung meist ohnehin die EVA-Nummer – ein Blick in die alte Konfiguration lohnt sich, bevor man die
  EVA-Nummer neu sucht.
- **`Mode`** ist nur grob genähert (immer "train", außer erkennbar Bus/Tram), da IRIS dieses HAFAS-Konzept nicht kennt.
- **`Operator`** ist der rohe numerische EVU-Code aus IRIS (z.B. "80"), nicht der Klarname wie bei HAFAS ("DB Fernverkehr AG").
  Es gibt keine mir bekannte offizielle, öffentliche Code→Name-Tabelle dafür.
- **`Product`** ist die DB-Zuggattung (ICE/IC/RE/RB/S/...) statt einer HAFAS-Produkt-ID - inhaltlich vergleichbar, aber
  andere Werte-Domäne. Der alte Kategorie-Filter (`traintype`, HAFAS-Produkt-IDs) muss daher in unserem neuen
  Kategorie-Filter-Feld (DB-Gattungscodes) manuell neu konfiguriert werden.
- Anders als beim alten Adapter ist hier ein **API-Key nötig** (siehe Abschnitt 1) - HAFAS über hafas-client brauchte
  keine Registrierung.
- Die Funktionen **Verbindungen/Routen** und **Verspätungsalarm** des alten Adapters sind hier (noch) nicht enthalten.

## 6. Bekannte Einschränkungen / mögliche Erweiterungen

- **Meldungstexte** (Verspätungsgründe, Freitexte über das `<m>`-Element) werden aktuell nicht in Klartext
  übersetzt (DB liefert dafür nur interne Codes ohne offizielle Textliste) - bei Bedarf in `lib/dbTimetablesClient.js`
  ergänzbar.
- Die Zeitumrechnung geht davon aus, dass der ioBroker-Host in der Zeitzone **Europe/Berlin** läuft (Standard bei
  deutschen Installationen). Bei einer anderen Server-Zeitzone müsste `parseIrisTime` in `lib/dbTimetablesClient.js`
  angepasst werden.
- Verspätungsalarm (wie im alten Adapter) ist hier nicht eingebaut, lässt sich aber leicht per ioBroker-Skript auf
  Basis von `.departures.0.delayed` nachbauen.
- Free-Plan = 60 Aufrufe/Minute. Bei vielen Stationen und kurzem Intervall ggf. Rate-Limit-Fehler (HTTP 429) im Log -
  dann Intervall erhöhen oder Stationsanzahl reduzieren.

## 7. Lizenzhinweis zu den Daten

Die von der API gelieferten Daten stehen unter **CC BY 4.0** (Deutsche Bahn AG). Bei Weiterverwendung/Veröffentlichung
ist eine Namensnennung der DB erforderlich, siehe Lizenzbedingungen auf der
[Produktseite](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables).

## Tests

```bash
npm install
npm test
```

`test/test-merge.js` prüft die Zusammenführung von Plan- und Change-Daten anhand eines Einzelbeispiels,
`test/test-client.js` testet den kompletten Client (Stationssuche, Mehrstunden-Lookahead, Sortierung,
Kategorie-Filter, Ausfälle) gegen einen gemockten HTTP-Layer.
