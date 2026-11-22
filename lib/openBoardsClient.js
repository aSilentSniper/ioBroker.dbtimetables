'use strict';

const { XMLParser } = require('fast-xml-parser');
const { dbApiRequest, DEFAULT_TIMEOUT_MS } = require('./dbApiRequest');

const OPEN_BOARDS_BASE_URL = 'https://apis.deutschebahn.com/db-api-marketplace/apis/open-boards/v1';
const OPEN_STATION_BASE_URL = 'https://apis.deutschebahn.com/db-api-marketplace/apis/open-station/v1';

// Die Doku nennt "application/vnd.de.db.ris+json", darauf antwortet die API aber mit HTTP 406 (Stand 11/2026)
const OPEN_BOARDS_ACCEPT = 'application/json';

// Höchstwert, den die API für maxEntriesPerTransportType akzeptiert (getestet: 50 geht, 100 nicht)
const MAX_ENTRIES_PER_TRANSPORT_TYPE = 50;

// Zeitfenster (Stunden ab "jetzt"), die nacheinander probiert werden, bis genug Abfahrten da sind.
// Die API erlaubt höchstens 8 Stunden zwischen timeStart und timeEnd.
const LOOKAHEAD_WINDOWS_HOURS = [1, 3, 8];

// Höchstzahl an Treffern einer Stationssuche. OpenStation liefert pro Station die komplette
// Infrastruktur mit (für "hannover" rund 1 MB), daher nicht mehr als nötig anfordern.
const SEARCH_LIMIT = 50;

const netexParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	isArray: name => ['SiteFrame', 'StopPlace', 'KeyValue'].includes(name),
});

/**
 * Liefert den Anzeigenamen eines Halts aus der stopPlaces-Liste einer OpenBoards-Antwort.
 *
 * @param {object} stopPlace Eintrag aus response.stopPlaces
 * @returns {string} Name (deutsch bevorzugt), leer wenn keiner vorhanden
 */
function stopPlaceName(stopPlace) {
	const names = (stopPlace && stopPlace.localizedNames) || [];
	const de = names.find(n => n && n.language === 'deu');
	return ((de || names[0]) && (de || names[0]).name) || '';
}

/**
 * Leitet aus dem OpenBoards-Verkehrsmittel (z.B. "HIGH_SPEED_TRAIN", "BUS") das grobe
 * "mode"-Feld ab, das der alte HAFAS-basierte Adapter hatte.
 *
 * @param {string|undefined} transportType transport.type aus OpenBoards
 * @returns {string} "bus", "tram" oder "train"
 */
function modeFromTransportType(transportType) {
	const t = (transportType || '').toUpperCase();
	if (t.includes('BUS')) {
		return 'bus';
	}
	if (t.includes('TRAM')) {
		return 'tram';
	}
	return 'train';
}

/**
 * Wandelt eine Abfahrt aus OpenBoards in das Format um, das auch der Timetables-Client liefert.
 *
 * @param {object} d Eintrag aus response.departures
 * @param {Map<string, string>} names EVA-Nummer -> Stationsname
 * @param {Map<string, string>} operators administrationId -> Betreibername
 */
function toDeparture(d, names, operators) {
	const t = d.transport || {};
	const category = t.category || '';
	const number = t.journeyNumber !== undefined && t.journeyNumber !== null ? String(t.journeyNumber) : '';
	const plannedTime = d.timeSchedule ? new Date(d.timeSchedule) : null;
	const actualTime = d.time ? new Date(d.time) : plannedTime;
	const delayMinutes =
		actualTime && plannedTime ? Math.round((actualTime.getTime() - plannedTime.getTime()) / 60000) : 0;

	const nameOf = eva => names.get(eva) || eva || '';
	let destinationEvas = ((t.direction && t.direction.stopPlaces) || []).map(s => s && s.evaNumber).filter(Boolean);
	if (!destinationEvas.length && d.journeyInfo && d.journeyInfo.destination) {
		destinationEvas = [d.journeyInfo.destination.evaNumber].filter(Boolean);
	}

	const plannedPlatform = (d.platformSchedule && d.platformSchedule.name) || '';
	return {
		// departureId ist nicht eindeutig (live gesehen: alle Abfahrten "8000191_D_1"), journeyId schon
		id: d.journeyId || d.departureId || '',
		category,
		number,
		owner: operators.get(t.administrationId) || t.administrationId || '',
		line: (t.line && t.line.name) || `${category}${number}`,
		destination: destinationEvas.map(nameOf).join(' / '),
		via: (t.via || []).filter(v => v && !v.cancelled).map(v => nameOf(v.evaNumber)),
		plannedTime,
		actualTime,
		delayMinutes,
		plannedPlatform,
		platform: (d.platform && d.platform.name) || plannedPlatform,
		cancelled: !!d.cancelled,
		mode: modeFromTransportType(t.type),
	};
}

/**
 * Liefert die journeyIds der Fahrten, mit denen eine Abfahrt gekoppelt fährt (travelsWith).
 *
 * @param {object} d Eintrag aus response.departures
 * @returns {string[]} journeyIds der gekoppelten Fahrten
 */
function coupledJourneyIds(d) {
	return (d.travelsWith || []).map(t => t && (t.journeyID || t.journeyId)).filter(Boolean);
}

/**
 * Fasst gekoppelte Fahrten (z.B. ICE 1069 + ICE 2831, die als ein Zug fahren) zu einer Abfahrt zusammen,
 * so wie es die Anzeigetafeln am Bahnsteig tun. OpenBoards liefert sie als getrennte Abfahrten,
 * die über travelsWith aufeinander verweisen.
 *
 * @param {{dep: object, coupledWith: string[]}[]} entries nach Zeit sortierte Abfahrten mit ihren Kopplungen
 * @returns {object[]} Abfahrten, gekoppelte Fahrten jeweils als ein Eintrag
 */
function mergeCoupledDepartures(entries) {
	const result = [];
	const byJourney = new Map();
	const joinUnique = (a, b) => (a === b || !b ? a : !a ? b : a.split(' / ').includes(b) ? a : `${a} / ${b}`);
	for (const { dep, coupledWith } of entries) {
		const partner = coupledWith.map(id => byJourney.get(id)).find(Boolean);
		if (!partner) {
			const copy = { ...dep };
			result.push(copy);
			byJourney.set(dep.id, copy);
			continue;
		}
		partner.line = `${partner.line} / ${dep.line}`;
		partner.number = `${partner.number} / ${dep.number}`;
		partner.destination = joinUnique(partner.destination, dep.destination);
		partner.owner = joinUnique(partner.owner, dep.owner);
		// ausgefallen ist der Zug nur, wenn alle Teile ausfallen
		partner.cancelled = partner.cancelled && dep.cancelled;
		byJourney.set(dep.id, partner);
	}
	return result;
}

/**
 * Prüft, ob eine Abfahrt zu den gewünschten Zuggattungen passt. Verglichen wird mit der Gattung
 * (z.B. "ICE", "S", "WFB") und mit dem Buchstabenteil der Linie (z.B. "RE" aus "RE60"),
 * damit ein Filter "RE" auch Regionalexpresse privater Betreiber findet.
 *
 * @param {object} dep Abfahrt im Format von {@link toDeparture}
 * @param {string[]|null} categories gewünschte Gattungen in Großbuchstaben, null = alle
 */
function matchesCategory(dep, categories) {
	if (!categories) {
		return true;
	}
	const linePrefix = (dep.line.match(/^[A-Za-zÄÖÜäöü]+/) || [''])[0].toUpperCase();
	return categories.includes(dep.category.toUpperCase()) || (!!linePrefix && categories.includes(linePrefix));
}

/**
 * Client für die Nachfolger der Timetables-API: OpenBoards (Abfahrtstafeln) und OpenStation (Stationssuche).
 * Beide APIs müssen in derselben Anwendung im DB API Marketplace abonniert sein.
 */
class OpenBoardsClient {
	/**
	 * @param {string} clientId DB-Client-Id
	 * @param {string} apiKey DB-Api-Key
	 * @param {object} [options] optionale Einstellungen
	 * @param {string} [options.boardsBaseUrl] abweichende Basis-URL für OpenBoards
	 * @param {string} [options.stationBaseUrl] abweichende Basis-URL für OpenStation
	 * @param {(msg: string) => void} [options.debug] optionaler Logger für Debug-Ausgaben
	 * @param {number} [options.timeoutMs] Timeout je HTTP-Request in Millisekunden
	 */
	constructor(clientId, apiKey, options = {}) {
		this.clientId = clientId;
		this.apiKey = apiKey;
		this.boardsBaseUrl = options.boardsBaseUrl || OPEN_BOARDS_BASE_URL;
		this.stationBaseUrl = options.stationBaseUrl || OPEN_STATION_BASE_URL;
		this.debug = options.debug || (() => {});
		this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
	}

	/**
	 * Führt einen Request mit den Zugangsdaten dieses Clients aus.
	 *
	 * @param {string} url vollständige URL
	 * @param {string} label Kurzbezeichnung für Fehlermeldungen
	 * @param {object} extra weitere Optionen für {@link dbApiRequest} (method, accept, body)
	 * @returns {Promise<string>} der Antworttext
	 */
	_request(url, label, extra) {
		return dbApiRequest(url, {
			clientId: this.clientId,
			apiKey: this.apiKey,
			label,
			timeoutMs: this.timeoutMs,
			debug: this.debug,
			...extra,
		});
	}

	/**
	 * Ruft eine rohe Abfahrtstafel von OpenBoards ab.
	 *
	 * @param {string} eva EVA-Nummer der Station
	 * @param {Date} timeStart Beginn des Zeitfensters
	 * @param {Date} timeEnd Ende des Zeitfensters (höchstens 8 Stunden nach timeStart)
	 * @returns {Promise<object>} die geparste JSON-Antwort
	 */
	async getDeparturesRaw(eva, timeStart, timeEnd) {
		const text = await this._request(`${this.boardsBaseUrl}/departures`, `OpenBoards /departures (${eva})`, {
			method: 'POST',
			accept: OPEN_BOARDS_ACCEPT,
			body: {
				stopPlaceOrStation: { evaNumbers: [String(eva)] },
				timeWindow: { timeStart: timeStart.toISOString(), timeEnd: timeEnd.toISOString() },
				maxEntriesPerTransportType: MAX_ENTRIES_PER_TRANSPORT_TYPE,
				maxViaStops: 3,
				languages: ['deu'],
			},
		});
		try {
			return JSON.parse(text);
		} catch {
			throw new Error(`OpenBoards lieferte kein gültiges JSON: ${text.slice(0, 200)}`);
		}
	}

	/**
	 * Baut eine fertige, sortierte und gefilterte Abfahrtstafel für eine Station.
	 * Fragt zunächst ein kurzes Zeitfenster ab und vergrößert es nur, wenn nicht genug
	 * passende Abfahrten gefunden wurden. Meist reicht ein einziger API-Aufruf.
	 *
	 * @param {string} eva EVA-Nummer der Station
	 * @param {object} [opts] optionale Einstellungen
	 * @param {number} [opts.count] Anzahl gewünschter Abfahrten (default 5)
	 * @param {string[]|null} [opts.categories] falls gesetzt: nur diese Zuggattungen (z.B. ["S","RE"])
	 * @param {Date} [opts.now] Referenzzeitpunkt (default: aktuelle Zeit)
	 * @returns {Promise<object[]>} die nächsten Abfahrten, sortiert und auf `count` begrenzt
	 */
	async getDepartureBoard(eva, opts = {}) {
		const count = opts.count || 5;
		const categories = opts.categories && opts.categories.length ? opts.categories.map(c => c.toUpperCase()) : null;
		const now = opts.now || new Date();

		let result = [];
		for (const hours of LOOKAHEAD_WINDOWS_HOURS) {
			const raw = await this.getDeparturesRaw(eva, now, new Date(now.getTime() + hours * 3600 * 1000));
			const { departures, complete } = this._buildBoard(raw, eva, categories, now);
			result = departures;
			// Ist die Antwort abgeschnitten, bringt ein größeres Fenster keine weiteren frühen Abfahrten
			if (result.length >= count || !complete) {
				break;
			}
		}
		return result.slice(0, count);
	}

	/**
	 * Wandelt eine rohe OpenBoards-Antwort in die sortierte, gefilterte Abfahrtsliste um.
	 *
	 * @param {object} raw JSON-Antwort von /departures
	 * @param {string} eva EVA-Nummer der konfigurierten Station
	 * @param {string[]|null} categories gewünschte Gattungen in Großbuchstaben, null = alle
	 * @param {Date} now Referenzzeitpunkt
	 * @returns {{departures: object[], complete: boolean}} Abfahrten und ob die Antwort vollständig war
	 */
	_buildBoard(raw, eva, categories, now) {
		const names = new Map(((raw && raw.stopPlaces) || []).map(s => [s.evaNumber, stopPlaceName(s)]));
		const operators = new Map(
			((raw && raw.administrations) || []).map(a => [a.administrationId, a.operatorName || a.operatorCode]),
		);
		// OpenBoards erweitert die Abfrage auf den ganzen Umsteigebereich (z.B. Bushaltestellen am Bahnhof).
		// Wie bisher nur die konfigurierte Station anzeigen.
		const rawDepartures = ((raw && raw.departures) || []).filter(d => !d.evaNumber || d.evaNumber === String(eva));

		// Bei zu vielen Einträgen kürzt die API je Verkehrsmittel (meta.truncatedTransportTypes).
		// Vollständig ist die Liste dann nur bis zur letzten Abfahrt des am frühesten abgeschnittenen Verkehrsmittels.
		const truncated = (raw && raw.meta && raw.meta.truncatedTransportTypes) || [];
		let cutoff = Infinity;
		for (const type of truncated) {
			const times = rawDepartures
				.filter(d => d.transport && d.transport.type === type)
				.map(d => new Date(d.time || d.timeSchedule).getTime());
			if (times.length) {
				cutoff = Math.min(cutoff, Math.max(...times));
			}
		}

		const entries = rawDepartures
			.map(d => ({ dep: toDeparture(d, names, operators), coupledWith: coupledJourneyIds(d) }))
			.filter(({ dep }) => {
				const t = (dep.actualTime || dep.plannedTime || new Date(0)).getTime();
				return t >= now.getTime() && t <= cutoff && matchesCategory(dep, categories);
			})
			.sort((a, b) => (a.dep.actualTime || a.dep.plannedTime) - (b.dep.actualTime || b.dep.plannedTime));
		return { departures: mergeCoupledDepartures(entries), complete: truncated.length === 0 };
	}

	/**
	 * Sucht Stationen über OpenStation. Der Suchbegriff wird irgendwo im Namen gesucht, ohne
	 * Beachtung der Groß-/Kleinschreibung ("pferdemarkt" findet "Langenhagen Pferdemarkt").
	 * Eine 7-stellige Zahl wird als EVA-Nummer behandelt, weil OpenStation nur nach Namen sucht.
	 *
	 * @param {string} pattern Suchbegriff oder EVA-Nummer
	 * @returns {Promise<{name: string, eva: string, ds100: string}[]>} gefundene Stationen (leer, wenn nichts passt)
	 */
	async searchStations(pattern) {
		const query = String(pattern || '').trim();
		if (!query) {
			return [];
		}
		if (/^\d{7}$/.test(query)) {
			return this._lookupEva(query);
		}
		const params = new URLSearchParams({
			stopPlaceName: query,
			limit: String(SEARCH_LIMIT),
			includeSitePathLinks: 'false',
		});
		const xml = await this._request(`${this.stationBaseUrl}/netex?${params}`, `OpenStation-Suche "${query}"`, {
			accept: 'application/xml',
		});
		return sortSearchResults(parseNetexStopPlaces(xml), query);
	}

	/**
	 * Ermittelt den Namen zu einer EVA-Nummer über eine kurze OpenBoards-Abfrage.
	 *
	 * @param {string} eva EVA-Nummer
	 */
	async _lookupEva(eva) {
		const now = new Date();
		const raw = await this.getDeparturesRaw(eva, now, new Date(now.getTime() + 30 * 60 * 1000));
		const stop = ((raw && raw.stopPlaces) || []).find(s => s.evaNumber === eva);
		if (stop) {
			return [{ name: stopPlaceName(stop) || eva, eva, ds100: '' }];
		}
		const considered = (raw && raw.meta && raw.meta.consideredStopPlaces) || [];
		return considered.includes(eva) ? [{ name: eva, eva, ds100: '' }] : [];
	}
}

/**
 * Liest den Text eines NeTEx-Textelements. OpenStation liefert Namen als gemischten Inhalt,
 * z.B. <Name lang="de">Hannover Hbf<Text lang="de">Hannover Hbf</Text></Name>.
 *
 * @param {unknown} value vom XML-Parser geliefertes Element
 * @returns {string} der Text, leer wenn keiner vorhanden
 */
function netexText(value) {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value !== 'object') {
		return String(value).trim();
	}
	const element = new Map(Object.entries(value));
	return netexText(element.get('#text')) || netexText(element.get('Text'));
}

/**
 * Liest die Stationen (Name, EVA-Nummer, DS100-Kürzel) aus einer NeTEx-Antwort von OpenStation.
 *
 * @param {string} xml NeTEx-XML
 * @returns {{name: string, eva: string, ds100: string}[]} Stationen mit EVA-Nummer
 */
function parseNetexStopPlaces(xml) {
	const obj = netexParser.parse(xml);
	const frames =
		obj &&
		obj.PublicationDelivery &&
		obj.PublicationDelivery.dataObjects &&
		obj.PublicationDelivery.dataObjects.CompositeFrame &&
		obj.PublicationDelivery.dataObjects.CompositeFrame.frames;
	const siteFrames = (frames && frames.SiteFrame) || [];
	const result = [];
	for (const sf of siteFrames) {
		for (const sp of (sf && sf.stopPlaces && sf.stopPlaces.StopPlace) || []) {
			const keys = new Map(((sp.keyList && sp.keyList.KeyValue) || []).map(kv => [kv.Key, kv.Value]));
			const eva = keys.get('EVA');
			if (!eva) {
				continue;
			}
			result.push({
				name: netexText(sp.Name) || String(eva),
				eva: String(eva),
				ds100: String(keys.get('RIL') || ''),
			});
		}
	}
	return result;
}

/**
 * Sortiert Suchtreffer: exakter Name zuerst, dann Namen, die mit dem Suchbegriff beginnen, dann der Rest.
 * Innerhalb einer Gruppe kürzere Namen zuerst, damit z.B. bei "hannover" der Hbf vor "Hannover-Messe / Laatzen" steht.
 *
 * @param {{name: string, eva: string, ds100: string}[]} stations Treffer
 * @param {string} query Suchbegriff
 * @returns {{name: string, eva: string, ds100: string}[]} sortierte Kopie der Treffer
 */
function sortSearchResults(stations, query) {
	const q = query.toLowerCase();
	const rank = s => {
		const n = s.name.toLowerCase();
		if (n === q) {
			return 0;
		}
		return n.startsWith(q) ? 1 : 2;
	};
	return stations
		.slice()
		.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name, 'de'));
}

module.exports = {
	OpenBoardsClient,
	parseNetexStopPlaces,
	OPEN_BOARDS_BASE_URL,
	OPEN_STATION_BASE_URL,
	MAX_ENTRIES_PER_TRANSPORT_TYPE,
};
