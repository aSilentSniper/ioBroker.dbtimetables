# ioBroker.dbtimetables

A departure-board adapter built on Deutsche Bahn's official APIs instead of HAFAS: [OpenBoards](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-boards) for the departures and [OpenStation](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-station) for the station search. The older [Timetables API](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables) (IRIS) is still supported until DB switches it off.

> **Timetables is being retired.** DB InfraGO is replacing the Timetables API with OpenBoards. Both run in parallel from November 2026, Timetables is expected to be switched off around mid 2027, and it no longer accepts new subscriptions. Since 0.2.0 the adapter uses OpenBoards by default. If your Marketplace application is only subscribed to Timetables, either add OpenBoards and OpenStation to it or set "Data source" to Timetables for the time being.

I wrote this as a replacement for the departure-board part of [ioBroker.fahrplan](https://github.com/gaudes/ioBroker.fahrplan), which relies on an unofficial HAFAS endpoint. OpenBoards returns planned and realtime data in a single call. With the old Timetables API (IRIS) the adapter has to fetch the raw plan and the changes separately and merge them itself. A German write-up with more background is in [docs/de/README.md](docs/de/README.md).

The adapter polls one or more stations (by their EVA number) and writes the next N departures per station into ioBroker states - line, destination, planned/actual time, delay, platform, cancellation - plus a JSON dump and a ready-made HTML table you can drop straight into a VIS view.

## Getting an API key

Register at [developers.deutschebahn.com](https://developers.deutschebahn.com/db-api-marketplace/apis/product), create an application, and subscribe it to the free plans of **OpenBoards** (departures) and **OpenStation** (station search). Both subscriptions must be in the same application. That gives you a Client-Id and an Api-Key. Enter both on the "Credentials" tab of the instance and let it start once.

## Finding a station

Stations are only addressed by a 7-digit EVA number, not by name. The "Departure boards" tab has a search box for exactly this: type a station name, hit "Suchen", and add the match straight to the station list below it with one click - no manual EVA lookup needed. That box is a small custom Admin UI component (requires **Admin 8 or newer**), built in `src-admin/` and shipped as `admin/custom/customComponents.js`; see [Developer tests](#developer-tests) for how to rebuild it.

With OpenStation the search matches **any part** of the station name (case-insensitive): "Pferdemarkt" finds "Langenhagen Pferdemarkt", and "hannover" lists all twelve stations with that word, main station first. A 7-digit number is taken as an EVA number and looked up directly. OpenStation can't search by DS100 code.

With the old Timetables data source the search matches only the **beginning** of the name, the EVA number or the DS100 code, and returns a single station per query.

That search asks the running adapter instance for results, so it only works once the instance is actually up with saved credentials. If it isn't (or comes back empty), you can still add a station manually and type in the EVA number by hand, or look one up directly:

```bash
curl -H "DB-Client-Id: YOUR_CLIENT_ID" -H "DB-Api-Key: YOUR_API_KEY" -H "Accept: application/xml" \
  "https://apis.deutschebahn.com/db-api-marketplace/apis/open-station/v1/netex?stopPlaceName=Karlsruhe&includeSitePathLinks=false"
```

The answer is NeTEx XML. Each `<StopPlace>` has the name in `<Name>` and the EVA number in the `keyList` entry with `<Key>EVA</Key>`.

or from an ioBroker script, once the adapter is running:

```js
sendTo('dbtimetables.0', 'searchStation', { pattern: 'Karlsruhe Hbf' }, (res) => {
    // success: [{ value: eva, label: "Name (eva, ds100)" }], nothing found: [], failure: { error: "..." }
    console.log(JSON.stringify(res));
});
```

## Configuration

Credentials tab:

| Field | What it does |
|---|---|
| DB-Client-Id / DB-Api-Key | from the DB API Marketplace, see above |
| Data source | OpenBoards + OpenStation (default) or the old Timetables API |
| Update interval | how often the adapter polls, in seconds. With OpenBoards each run usually costs one API call per station (up to three if the station has few departures and the adapter has to look further ahead). With Timetables it's 2-5 calls per station. 30-60s is fine for a handful of stations on the free plans. |
| Mark as delayed from | delay in minutes after which a departure counts as "delayed" (default 2, same as the old adapter) |

Departure boards tab: a search box (see [Finding a station](#finding-a-station)) plus one row per station, managed directly in that same custom component:

| Field | What it does |
|---|---|
| Active | enable/disable this row |
| Name | whatever you want to call it, becomes the object folder name (`stations.<Name>`) |
| EVA number | the actual station id used for API calls |
| Number of departures | how many upcoming departures to fetch |
| Time offset (min.) | skip departures earlier than now+N minutes, default 0 |
| Category filter | e.g. `S,RE,RB` to only show certain train categories, empty for all |

## Object tree

I kept the object schema for the departure-board feature identical to `ioBroker.fahrplan`'s (`lib/deptt.js`, `lib/depttdep.js`, `lib/line.js`, `lib/station.js`), so existing VIS bindings and scripts ideally only need the instance name swapped (`fahrplan.0` → `dbtimetables.0`).

```
dbtimetables.0.DepartureTimetable<N>.Enabled                     bool - also written for disabled rows
dbtimetables.0.DepartureTimetable<N>.Station.Name                station name
dbtimetables.0.DepartureTimetable<N>.Station.eBhf                station id (here: EVA number)
dbtimetables.0.DepartureTimetable<N>.Station.CustomName           freely assigned name
dbtimetables.0.DepartureTimetable<N>.Station.Type                 fixed "station"
dbtimetables.0.DepartureTimetable<N>.Station.JSON
dbtimetables.0.DepartureTimetable<N>.JSON                         complete departure list as JSON
dbtimetables.0.DepartureTimetable<N>.HTML                         ready-made HTML table (time/direction/platform/delay/type)
dbtimetables.0.DepartureTimetable<N>.<i>.JSON                     single departure as JSON
dbtimetables.0.DepartureTimetable<N>.<i>.Departure                 actual departure, ms timestamp
dbtimetables.0.DepartureTimetable<N>.<i>.DeparturePlanned           planned departure, ms timestamp
dbtimetables.0.DepartureTimetable<N>.<i>.DepartureDelaySeconds      delay in seconds
dbtimetables.0.DepartureTimetable<N>.<i>.DepartureOnTime            bool, only true for exactly 0 delay (a quirk of the original that I kept on purpose)
dbtimetables.0.DepartureTimetable<N>.<i>.DepartureDelayed           bool, true only from the threshold on
dbtimetables.0.DepartureTimetable<N>.<i>.Name                      line name, e.g. "ICE 273"
dbtimetables.0.DepartureTimetable<N>.<i>.Direction                 destination
dbtimetables.0.DepartureTimetable<N>.<i>.Mode                      "train"/"bus"/"tram" - from the transport type (OpenBoards) or guessed from the category (Timetables)
dbtimetables.0.DepartureTimetable<N>.<i>.Operator                  operator name, e.g. "DB Regio AG Nord" (OpenBoards); numeric operator code with Timetables
dbtimetables.0.DepartureTimetable<N>.<i>.Product                   train category (ICE/RE/RB/S/...), replaces the HAFAS product id
dbtimetables.0.DepartureTimetable<N>.<i>.Platform                  current platform
dbtimetables.0.DepartureTimetable<N>.<i>.PlannedPlatform            planned platform
dbtimetables.0.DepartureTimetable<N>.<i>.Cancelled                  not present in the original - IRIS reports cancellations, the HAFAS-based board didn't
```

A few things that won't just carry over from the old adapter, though: the instance name is necessarily different, so every binding/script needs at least that adjusted. Configuration isn't migrated automatically either - the station table has to be rebuilt by hand (tip: the old adapter's `station_from` id is usually already the EVA number for real DB stations, so it's worth checking the old config before searching again). With Timetables, `Mode` is only a rough guess and `Operator` a raw numeric code (OpenBoards delivers both properly), and `Product` uses DB's own category codes rather than HAFAS product ids, so the old category filter needs reconfiguring. You'll also need an API key here, unlike the HAFAS-based version. Connections/routing and the delay-alert feature from the old adapter aren't in here (yet).

## Known limitations

- Delay reason texts (the `<m>` element) aren't translated to plain text - DB only exposes internal codes with no official text list, so this would need a manually maintained lookup in `lib/dbTimetablesClient.js`.
- Timetables only: time parsing assumes the ioBroker host runs in `Europe/Berlin`, which is the default for German installations. OpenBoards sends times with a timezone, so this doesn't apply there.
- OpenBoards covers the whole transfer area of a station (e.g. bus stops in front of it). The adapter only shows departures of the configured EVA number, as before.
- No built-in delay alert, but it's a one-liner in an ioBroker script against `.departures.0.delayed`.
- The free plans have rate limits (Timetables 60 requests/minute, OpenBoards 10 per second). If you see HTTP 429 in the log, back off the interval or trim the station list.

## Data license

The data itself is licensed by Deutsche Bahn AG under CC BY 4.0 - if you redistribute or publish it, you need to attribute DB, see the license section on the product pages of [OpenBoards](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-boards) and [Timetables](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables).

## Developer tests

```bash
npm install
npm test
```

`test/test-openboards.js` runs the OpenBoards/OpenStation client against real, recorded API responses in `test/fixtures/` (mapping, time windows, truncation, category filter, search). `test/test-merge.js` and `test/test-client.js` cover the Timetables client (plan/change merge, multi-hour lookahead, sorting, cancellations) against a mocked HTTP layer.

## Rebuilding the admin UI component

The station-search-and-management widget on the "Departure boards" tab is a separate React project under `src-admin/`, built with Vite and Module Federation against `@iobroker/gui-components` (Admin 8+). It's not part of the regular `npm test`/`npm run lint` flow because it has its own dependency tree. To rebuild it after changing anything in `src-admin/src/`:

```bash
npm run build-admin-ui
```

This installs `src-admin`'s own dependencies, builds it with Vite, and copies the result into `admin/custom/`, which is what actually ships with the adapter (`admin/jsonConfig.json` references it via `type: "custom"`).

## Changelog
### **WORK IN PROGRESS**

- new data source OpenBoards + OpenStation, the successor of the Timetables API (expected shutdown mid 2027). It is the new default; Timetables can still be selected in the instance settings
- departures come from a single API call per station and include the operator name
- coupled trains (e.g. ICE 1069 + ICE 2831) are shown as one departure, like on the platform displays
- station search finds any part of the name ("Pferdemarkt" finds "Langenhagen Pferdemarkt") and lists all matches, main station first

### 0.1.1 (2026-09-21)

- station search: a query without a match no longer shows an empty entry, and the admin UI explains how the search matches
- API requests time out after 15 s, and a poll run is skipped while the previous one is still running
- state roles corrected: timestamps use `value.time` (numeric), text values use `text`
- departure object names are only written when the line changes, not on every poll

### 0.1.0 (2026-09-03)

- initial release: departure board per station, plan+changes merge, HTML/JSON output, admin UI station search

## License

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
