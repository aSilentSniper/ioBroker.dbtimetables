# ioBroker.dbtimetables

A departure-board adapter built on Deutsche Bahn's official [Timetables API](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables) (IRIS), instead of HAFAS.

I wrote this as a replacement for the departure-board part of [ioBroker.fahrplan](https://github.com/gaudes/ioBroker.fahrplan), which relies on an unofficial HAFAS endpoint. HAFAS gives you a ready-made connection including realtime data in one call; IRIS only gives you the raw plan and, separately, whatever has changed since - this adapter fetches both and merges them itself. A German write-up with more background is in [docs/de/README.md](docs/de/README.md).

The adapter polls one or more stations (by their EVA number) and writes the next N departures per station into ioBroker states - line, destination, planned/actual time, delay, platform, cancellation - plus a JSON dump and a ready-made HTML table you can drop straight into a VIS view.

## Getting an API key

Register at [developers.deutschebahn.com](https://developers.deutschebahn.com/db-api-marketplace/apis/product), create an application, and subscribe it to the free "Timetables" plan (60 requests/minute). That gives you a Client-Id and an Api-Key. Enter both on the "Credentials" tab of the instance and let it start once.

## Finding a station

Stations are only addressed by a 7-digit EVA number, not by name. Once the instance is running with valid credentials, you don't need to look it up by hand: on the "Departure boards" tab, add a row and type the station name into "Search term" - the "EVA number" field next to it fills with matching stations to choose from.

That search asks the running adapter instance for results, so it only works once the instance is actually up with saved credentials. If it isn't (or comes back empty), the field still accepts a manually typed EVA number, or you can look one up directly:

```bash
curl -H "DB-Client-Id: YOUR_CLIENT_ID" -H "DB-Api-Key: YOUR_API_KEY" \
  "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/station/Karlsruhe"
```

```xml
<stations>
  <station name="Karlsruhe Hbf" eva="8000191" ds100="RK"/>
  <station name="Karlsruhe West" eva="8007433" ds100="RKW"/>
</stations>
```

or from an ioBroker script, once the adapter is running:

```js
sendTo('dbtimetables.0', 'searchStation', { pattern: 'Karlsruhe' }, (res) => {
    // res: [{ value: eva, label: "Name (eva, ds100)" }, ...]
    console.log(JSON.stringify(res));
});
```

## Configuration

Credentials tab:

| Field | What it does |
|---|---|
| DB-Client-Id / DB-Api-Key | from the DB API Marketplace, see above |
| Update interval | how often the adapter polls, in seconds. Each run costs 2-5 API calls per station (one for changes, one to four for plan hour-slices). 30-60s is fine for a handful of stations on the free plan. |
| Mark as delayed from | delay in minutes after which a departure counts as "delayed" (default 2, same as the old adapter) |

Departure boards tab, one row per station:

| Field | What it does |
|---|---|
| Active | enable/disable this row |
| Name | whatever you want to call it, becomes the object folder name (`stations.<Name>`) |
| Search term | station name used for the EVA-number search above |
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
dbtimetables.0.DepartureTimetable<N>.<i>.Mode                      rough guess at "train"/"bus"/"tram" - IRIS has no equivalent to HAFAS' "mode"
dbtimetables.0.DepartureTimetable<N>.<i>.Operator                  numeric operator code - IRIS gives no display name like HAFAS does
dbtimetables.0.DepartureTimetable<N>.<i>.Product                   train category (ICE/RE/RB/S/...), replaces the HAFAS product id
dbtimetables.0.DepartureTimetable<N>.<i>.Platform                  current platform
dbtimetables.0.DepartureTimetable<N>.<i>.PlannedPlatform            planned platform
dbtimetables.0.DepartureTimetable<N>.<i>.Cancelled                  not present in the original - IRIS reports cancellations, the HAFAS-based board didn't
```

A few things that won't just carry over from the old adapter, though: the instance name is necessarily different, so every binding/script needs at least that adjusted. Configuration isn't migrated automatically either - the station table has to be rebuilt by hand (tip: the old adapter's `station_from` id is usually already the EVA number for real DB stations, so it's worth checking the old config before searching again). `Mode` is only ever a rough guess, `Operator` stays a raw numeric code since I don't know of a public code-to-name table for it, and `Product` uses DB's own category codes rather than HAFAS product ids, so the old category filter needs reconfiguring. You'll also need an API key here, unlike the HAFAS-based version. Connections/routing and the delay-alert feature from the old adapter aren't in here (yet).

## Known limitations

- Delay reason texts (the `<m>` element) aren't translated to plain text - DB only exposes internal codes with no official text list, so this would need a manually maintained lookup in `lib/dbTimetablesClient.js`.
- Time parsing assumes the ioBroker host runs in `Europe/Berlin`, which is the default for German installations. A different server timezone would need `parseIrisTime` in `lib/dbTimetablesClient.js` adjusted.
- No built-in delay alert, but it's a one-liner in an ioBroker script against `.departures.0.delayed`.
- The free plan caps out at 60 requests/minute - with many stations and a short poll interval you'll start seeing HTTP 429 in the log, so back off the interval or trim the station list.

## Data license

The data itself is licensed by Deutsche Bahn AG under CC BY 4.0 - if you redistribute or publish it, you need to attribute DB, see the license section on the [product page](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables).

## Developer tests

```bash
npm install
npm test
```

`test/test-merge.js` checks merging plan and change data on a single example, `test/test-client.js` exercises the full client (search, multi-hour lookahead, sorting, category filter, cancellations) against a mocked HTTP layer.

## Changelog

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
