# ioBroker.dbtimetables (Deutsch)

> Dies ist die deutsche Langfassung der Dokumentation. Die offizielle, für den ioBroker-Adapter-Checker
> maßgebliche Version ist die englische [README.md](../../README.md) im Projekt-Root.

Abfahrtstafel-Adapter auf Basis der **offiziellen APIs der Deutschen Bahn** vom
[DB API Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/product): **OpenBoards** für die
Abfahrten und **OpenStation** für die Stationssuche. Er ersetzt den HAFAS-basierten
[ioBroker.fahrplan](https://github.com/gaudes/ioBroker.fahrplan) für den Anwendungsfall "Abfahrtstafel für eine Station".

> **Die Timetables-API wird abgeschaltet.** Die DB InfraGO ersetzt sie durch OpenBoards. Seit November 2026 laufen
> beide parallel, die Abschaltung von Timetables ist für etwa Mitte 2027 geplant, und neue Abos dafür werden nicht
> mehr angenommen. Ab Version 0.2.0 nutzt der Adapter standardmäßig OpenBoards. Wer bisher nur Timetables abonniert
> hat, ergänzt in seiner Anwendung die Abos für OpenBoards und OpenStation oder stellt die "Datenquelle" in der
> Instanzkonfiguration übergangsweise auf Timetables.

> Unterschied zum alten Adapter: HAFAS liefert fertige Verbindungen inkl. Echtzeit in einem Aufruf, OpenBoards ebenso.
> Bei der alten Timetables-API muss der Adapter den rohen Sollfahrplan (`plan`) und die aktuellen Änderungen
> (`fchg`) getrennt holen und selbst zusammenführen.

## 1. Zugangsdaten (Client-ID / API-Key) besorgen

1. Auf [developers.deutschebahn.com](https://developers.deutschebahn.com/db-api-marketplace/apis/product) registrieren bzw. anmelden.
2. Im Bereich **Anwendungen** eine neue Anwendung anlegen (nur ein Name ist Pflicht, z.B. "ioBroker").
3. Zur Produktseite **[OpenBoards](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-boards)** gehen und **Abonnieren** klicken.
4. Nutzungsplan **Free** wählen (kostenlos), die zuvor angelegte Anwendung auswählen, mit **Weiter** und **Fertig** abschließen.
5. Dasselbe für **[OpenStation](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-station)** wiederholen, mit **derselben Anwendung**.
6. In der Anwendungsübersicht stehen jetzt **Client ID** und **Client Secret** (= API-Key). Beides in die Adapterkonfiguration eintragen.

Fehlt ein Abo, steht im Log "Authentifizierung fehlgeschlagen (HTTP 401) ... Cannot find valid subscription".

## 2. EVA-Nummer der Station herausfinden

Die API kennt Stationen nur über ihre 7-stellige **EVA-Nummer**, nicht über den Namen. Kein curl mehr nötig:

**Direkt in der Instanzkonfiguration (empfohlen):**

Im Tab "Abfahrtstafeln" gibt es dafür eine eigene Suche (ein selbstgebautes Admin-8-Custom-Widget, Quellcode
unter `src-admin/`): Stationsnamen eintippen, "Suchen" klicken, Treffer per Klick zur Stationsliste darunter
hinzufügen - fertig. Die komplette Stationsverwaltung (hinzufügen, bearbeiten, löschen, aktivieren) läuft in
diesem einen Widget statt in einer klassischen jsonConfig-Tabelle.

Mit OpenStation findet die Suche einen **beliebigen Teil** des Stationsnamens (ohne Beachtung der
Groß-/Kleinschreibung): "Pferdemarkt" findet "Langenhagen Pferdemarkt", "hannover" listet alle zwölf Stationen mit
diesem Wort, den Hauptbahnhof zuerst. Eine 7-stellige Zahl wird direkt als EVA-Nummer nachgeschlagen. Nach
DS100-Kürzeln kann OpenStation nicht suchen.

Mit der alten Datenquelle Timetables findet die Suche nur den **Anfang** des Namens, die EVA-Nummer oder das
DS100-Kürzel und liefert pro Anfrage nur eine Station.

Voraussetzung: Die Adapterinstanz läuft bereits mit gültigem Client-Id/Api-Key (die Suche fragt die
laufende Instanz per `sendTo` ab) **und Admin ist Version 8 oder neuer** - das Widget nutzt die neue,
React-basierte Custom-Component-API von Admin 8 (Module Federation, `guiApi: 2`). Ist die Instanz nicht
aktiv oder sind die Zugangsdaten noch nicht gespeichert, kommt eine Fehlermeldung im Widget - die
EVA-Nummer kann dann trotzdem manuell in der Stationsliste eingetragen werden.

**Alternativ per curl** (z.B. wenn die Instanz noch nicht läuft):

```bash
curl -H "DB-Client-Id: DEINE_CLIENT_ID" -H "DB-Api-Key: DEIN_API_KEY" -H "Accept: application/xml" \
  "https://apis.deutschebahn.com/db-api-marketplace/apis/open-station/v1/netex?stopPlaceName=Karlsruhe&includeSitePathLinks=false"
```

Die Antwort ist NeTEx-XML. Jede Station steht in einem `<StopPlace>`, der Name in `<Name>`, die EVA-Nummer im
`keyList`-Eintrag mit `<Key>EVA</Key>`. Diese Nummer trägst du in die Stationentabelle ein.

**Alternativ per ioBroker-Skript / sendTo**, sobald der Adapter läuft und Zugangsdaten hinterlegt sind:

```js
sendTo('dbtimetables.0', 'searchStation', { pattern: 'Karlsruhe Hbf' }, (res) => {
    // Erfolg: [{ value: eva, label: "Name (eva, ds100)" }], nichts gefunden: [], Fehler: { error: "..." }
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
| Datenquelle | OpenBoards + OpenStation (Standard) oder die alte Timetables-API |
| Aktualisierungsintervall | wie oft neu abgefragt wird (Sekunden). Mit OpenBoards verbraucht jede Station meist 1 API-Aufruf pro Durchlauf (bis zu 3, wenn wenig fährt und der Adapter weiter vorausschauen muss). Mit Timetables sind es 2-5 Aufrufe. Bei wenigen Stationen reichen 30-60s. |
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
dbtimetables.0.DepartureTimetable<N>.<i>.Mode                      "train"/"bus"/"tram" (OpenBoards: aus dem Verkehrsmittel, Timetables: grob aus der Gattung geraten)
dbtimetables.0.DepartureTimetable<N>.<i>.Operator                  Betreibername, z.B. "DB Regio AG Nord" (OpenBoards); mit Timetables nur der numerische EVU-Code
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
- Nur mit der alten Datenquelle Timetables: **`Mode`** ist grob genähert (immer "train", außer erkennbar Bus/Tram),
  und **`Operator`** ist der rohe numerische EVU-Code (z.B. "80") statt des Klarnamens. OpenBoards liefert beides richtig.
- **`Product`** ist die DB-Zuggattung (ICE/IC/RE/RB/S/...) statt einer HAFAS-Produkt-ID - inhaltlich vergleichbar, aber
  andere Werte-Domäne. Der alte Kategorie-Filter (`traintype`, HAFAS-Produkt-IDs) muss daher in unserem neuen
  Kategorie-Filter-Feld (DB-Gattungscodes) manuell neu konfiguriert werden.
- Anders als beim alten Adapter ist hier ein **API-Key nötig** (siehe Abschnitt 1) - HAFAS über hafas-client brauchte
  keine Registrierung.
- Die Funktionen **Verbindungen/Routen** und **Verspätungsalarm** des alten Adapters sind hier (noch) nicht enthalten.

## 6. Bekannte Einschränkungen / mögliche Erweiterungen

- **Meldungstexte** (Verspätungsgründe, Hinweise) werden noch nicht als Datenpunkte ausgegeben. OpenBoards liefert
  sie im Gegensatz zu Timetables im Klartext mit, das wäre also eine naheliegende Erweiterung.
- OpenBoards fragt den ganzen Umsteigebereich einer Station ab (z.B. auch Bushaltestellen davor). Der Adapter zeigt
  wie bisher nur die Abfahrten der konfigurierten EVA-Nummer.
- Nur Timetables: Die Zeitumrechnung geht davon aus, dass der ioBroker-Host in der Zeitzone **Europe/Berlin** läuft
  (Standard bei deutschen Installationen). OpenBoards liefert Zeiten mit Zeitzone, dort spielt das keine Rolle.
- Verspätungsalarm (wie im alten Adapter) ist hier nicht eingebaut, lässt sich aber leicht per ioBroker-Skript auf
  Basis von `.departures.0.delayed` nachbauen.
- Die Free-Pläne sind begrenzt (Timetables 60 Aufrufe/Minute, OpenBoards 10 pro Sekunde). Bei Rate-Limit-Fehlern
  (HTTP 429) im Log das Intervall erhöhen oder die Stationsanzahl reduzieren.

## 7. Lizenzhinweis zu den Daten

Die von der API gelieferten Daten stehen unter **CC BY 4.0** (Deutsche Bahn AG). Bei Weiterverwendung/Veröffentlichung
ist eine Namensnennung der DB erforderlich, siehe Lizenzbedingungen auf den Produktseiten von
[OpenBoards](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-boards) und
[Timetables](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables).

## Tests

```bash
npm install
npm test
```

`test/test-openboards.js` testet den OpenBoards/OpenStation-Client gegen echte, aufgezeichnete API-Antworten in
`test/fixtures/` (Umwandlung, Zeitfenster, abgeschnittene Antworten, Kategorie-Filter, Suche).
`test/test-merge.js` und `test/test-client.js` decken den Timetables-Client ab (Zusammenführung von Plan und
Änderungen, Mehrstunden-Lookahead, Sortierung, Ausfälle) gegen einen gemockten HTTP-Layer.
