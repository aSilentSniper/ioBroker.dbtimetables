# ioBroker.dbtimetables

Departure-board adapter based on the **official Deutsche Bahn Timetables API** (IRIS) from the
[DB API Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables).

## English (short version)

This adapter polls Deutsche Bahn's official Timetables (IRIS) REST API for one or more stations
(identified by their 7-digit EVA number) and publishes the next N departures per station as ioBroker
states (line, destination, planned/actual time, delay in minutes, platform, cancelled flag), plus a
ready-made JSON array and an HTML table for direct use in VIS.

**Setup**
1. Register at [developers.deutschebahn.com](https://developers.deutschebahn.com/db-api-marketplace/apis/product), create an application and subscribe it to the free "Timetables" plan (60 requests/minute) to get a **Client-Id** and **Api-Key**.
2. Find your station's EVA number, e.g. via `curl -H "DB-Client-Id: ..." -H "DB-Api-Key: ..." "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/station/<name>"`.
3. Enter Client-Id, Api-Key and one row per station (name, EVA number, number of departures, optional category filter) in the adapter configuration.

Data is provided by Deutsche Bahn AG under **CC BY 4.0** - attribution is required for any redistribution,
see the license section on the [product page](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables).

**Changelog**

### 0.1.0 (2026-09-03)
- initial release: departure board per station, plan+changes merge, HTML/JSON output

## Deutsch (ausführlich)

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

Die API kennt Stationen nur über ihre 7-stellige **EVA-Nummer**, nicht über den Namen. Zwei Wege, sie zu finden:

**Per curl (empfohlen, sofort verfügbar):**

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

**Per ioBroker-Skript / sendTo**, sobald der Adapter läuft und Zugangsdaten hinterlegt sind:

```js
sendTo('dbtimetables.0', 'searchStation', { pattern: 'Karlsruhe' }, (res) => {
    console.log(JSON.stringify(res));
});
```

## 3. Installation

Da dies ein selbst erstellter Adapter ist (nicht im offiziellen ioBroker-Repository), installierst du ihn lokal:

```bash
cd /opt/iobroker            # bzw. dein ioBroker-Installationsverzeichnis
npm install /pfad/zu/iobroker.dbtimetables --production
iobroker add dbtimetables
```

Alternativ in der Admin-Oberfläche unter **Adapter → Eigenen Adapter installieren** den entpackten Ordnerpfad
bzw. eine Git-URL angeben, falls du das Projekt in ein eigenes Repository legst.

## 4. Konfiguration

**Tab "Zugangsdaten"**

| Feld | Beschreibung |
|---|---|
| DB-Client-Id / DB-Api-Key | siehe Schritt 1 |
| Aktualisierungsintervall | wie oft neu abgefragt wird (Sekunden). Pro Durchlauf verbraucht jede Station 2-5 API-Aufrufe (1x Changes + 1-4x Plan-Stundenslices). Beim Free-Plan (60/min) reichen bei wenigen Stationen auch 30-60s. |
| Verspätet markieren ab | ab wie vielen Minuten Verspätung eine Abfahrt als "delayed" markiert wird (Standard 2, wie beim alten Adapter) |

**Tab "Abfahrtstafeln"** – eine Zeile pro gewünschter Station:

| Feld | Beschreibung |
|---|---|
| Aktiv | Zeile aktiv/inaktiv |
| Name | frei wählbarer Name, wird zum Objekt-Ordnernamen (`stations.<Name>`) |
| EVA-Nummer | siehe Schritt 2 |
| Anzahl Abfahrten | wie viele nächste Abfahrten abgerufen werden |
| Zeit-Offset (Min.) | Abfahrten erst ab jetzt+N Minuten anzeigen (Pendant zu "Zeit-Offset" beim alten Adapter), Standard 0 |
| Kategorie-Filter | optional, z.B. `S,RE,RB` um nur bestimmte Zuggattungen zu zeigen; leer = alle |

## 5. Objektbaum – kompatibel zu ioBroker.fahrplan (nur Abfahrtstafeln)

Ich habe mir den tatsächlichen Quellcode von `ioBroker.fahrplan` (`lib/deptt.js`, `lib/depttdep.js`, `lib/line.js`,
`lib/station.js`) angesehen und das Objektschema für die Abfahrtstafeln-Funktion bewusst identisch nachgebaut, damit
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
