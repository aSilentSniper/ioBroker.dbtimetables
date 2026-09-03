'use strict';

const { XMLParser } = require('fast-xml-parser');

const DEFAULT_BASE_URL = 'https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1';

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	// diese Tags müssen immer als Array behandelt werden, auch wenn nur 1 Element vorhanden ist
	isArray: (name) => ['s', 'm', 'station'].includes(name),
});

function toArray(value) {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

/**
 * Wandelt einen IRIS-Zeitstempel (Format yyMMddHHmm) in ein Date-Objekt (lokale Zeit) um.
 * @param {string|undefined} value
 * @returns {Date|null}
 */
function parseIrisTime(value) {
	if (!value || value.length !== 10) return null;
	const yy = parseInt(value.slice(0, 2), 10);
	const month = parseInt(value.slice(2, 4), 10);
	const day = parseInt(value.slice(4, 6), 10);
	const hour = parseInt(value.slice(6, 8), 10);
	const minute = parseInt(value.slice(8, 10), 10);
	if ([yy, month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
	return new Date(2000 + yy, month - 1, day, hour, minute, 0, 0);
}

function pad2(n) {
	return String(n).padStart(2, '0');
}

/** Formatiert ein Datum als yyMMdd, wie von /plan/{eva}/{date}/{hour} erwartet. */
function formatIrisDate(date) {
	return `${pad2(date.getFullYear() % 100)}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

/** Formatiert die Stunde eines Datums als zweistelligen String (00-23). */
function formatIrisHour(date) {
	return pad2(date.getHours());
}

class DbTimetablesClient {
	/**
	 * @param {string} clientId DB-Client-Id
	 * @param {string} apiKey DB-Api-Key
	 * @param {object} [options]
	 * @param {string} [options.baseUrl]
	 * @param {(msg: string) => void} [options.debug] optionaler Logger für Debug-Ausgaben
	 */
	constructor(clientId, apiKey, options = {}) {
		this.clientId = clientId;
		this.apiKey = apiKey;
		this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
		this.debug = options.debug || (() => {});
	}

	async _get(path) {
		const url = `${this.baseUrl}${path}`;
		this.debug(`GET ${url}`);
		const res = await fetch(url, {
			headers: {
				'DB-Client-Id': this.clientId,
				'DB-Api-Key': this.apiKey,
				Accept: 'application/xml',
			},
		});
		const text = await res.text();
		if (!res.ok) {
			if (res.status === 401 || res.status === 403) {
				throw new Error(`Authentifizierung fehlgeschlagen (HTTP ${res.status}) - Client-Id/API-Key prüfen`);
			}
			if (res.status === 404) {
				throw new Error(`Nicht gefunden (HTTP 404) für ${path}`);
			}
			if (res.status === 429) {
				throw new Error('Rate-Limit erreicht (HTTP 429) - max. 60 Aufrufe/Minute im Free-Plan');
			}
			throw new Error(`HTTP ${res.status} für ${path}: ${text.slice(0, 200)}`);
		}
		return text;
	}

	/**
	 * Sucht Stationen anhand eines Namensmusters (auch Teilstring) oder EVA/DS100.
	 * @param {string} pattern
	 * @returns {Promise<{name: string, eva: string, ds100: string}[]>}
	 */
	async searchStations(pattern) {
		const xml = await this._get(`/station/${encodeURIComponent(pattern)}`);
		const obj = xmlParser.parse(xml);
		const stations = toArray(obj && obj.stations && obj.stations.station);
		return stations.map((s) => ({
			name: s['@_name'] || '',
			eva: String(s['@_eva'] || ''),
			ds100: s['@_ds100'] || '',
		}));
	}

	/**
	 * Liefert den rohen Sollfahrplan (Plan) für eine Station und eine Stunden-Slice.
	 * @param {string} eva
	 * @param {Date} sliceDate Datum/Uhrzeit, deren Stunde abgefragt werden soll
	 * @returns {Promise<object[]>} Liste roher <s>-Objekte (aus fast-xml-parser)
	 */
	async getPlanHour(eva, sliceDate) {
		const date = formatIrisDate(sliceDate);
		const hour = formatIrisHour(sliceDate);
		const xml = await this._get(`/plan/${eva}/${date}/${hour}`);
		const obj = xmlParser.parse(xml);
		return toArray(obj && obj.timetable && obj.timetable.s);
	}

	/**
	 * Liefert alle aktuell bekannten Änderungen (Verspätungen, Gleiswechsel, Ausfälle) für eine Station.
	 * @param {string} eva
	 * @returns {Promise<Map<string, object>>} Map von Stop-Id auf das rohe <s>-Änderungsobjekt
	 */
	async getChanges(eva) {
		const xml = await this._get(`/fchg/${eva}`);
		const obj = xmlParser.parse(xml);
		const stops = toArray(obj && obj.timetable && obj.timetable.s);
		const map = new Map();
		for (const s of stops) map.set(s['@_id'], s);
		return map;
	}

	/**
	 * Baut eine fertige, sortierte und gefilterte Abfahrtstafel für eine Station.
	 * Holt dafür den Plan für die aktuelle Stunde (und ggf. weitere folgende Stunden,
	 * bis genug zukünftige Abfahrten gefunden wurden) sowie die aktuellen Änderungen,
	 * und führt beides zusammen.
	 *
	 * @param {string} eva
	 * @param {object} [opts]
	 * @param {number} [opts.count] Anzahl gewünschter Abfahrten (default 5)
	 * @param {string[]} [opts.categories] falls gesetzt: nur diese Zuggattungen (z.B. ["S","RE"])
	 * @param {number} [opts.maxLookaheadHours] max. Anzahl Stunden-Slices, die zusätzlich geladen werden (default 4)
	 * @param {Date} [opts.now] Referenzzeitpunkt (default: aktuelle Zeit)
	 * @returns {Promise<object[]>}
	 */
	async getDepartureBoard(eva, opts = {}) {
		const count = opts.count || 5;
		const categories = opts.categories && opts.categories.length ? opts.categories.map((c) => c.toUpperCase()) : null;
		const maxLookaheadHours = opts.maxLookaheadHours || 4;
		const now = opts.now || new Date();

		const changesById = await this.getChanges(eva);

		const rawStops = [];
		const seenIds = new Set();
		for (let h = 0; h < maxLookaheadHours; h++) {
			const sliceDate = new Date(now.getTime() + h * 60 * 60 * 1000);
			let stops;
			try {
				stops = await this.getPlanHour(eva, sliceDate);
			} catch (err) {
				// eine einzelne fehlende/leere Slice soll den Rest nicht abbrechen
				this.debug(`Plan-Slice ${h} für ${eva} fehlgeschlagen: ${err.message}`);
				stops = [];
			}
			for (const s of stops) {
				if (seenIds.has(s['@_id'])) continue; // Slices überlappen sich teilweise
				seenIds.add(s['@_id']);
				rawStops.push(s);
			}

			const futureCount = this._countFutureDepartures(rawStops, changesById, now, categories);
			if (futureCount >= count) break;
		}

		const departures = this._mergeAndFilter(rawStops, changesById, categories);
		departures.sort((a, b) => (a.actualTime || a.plannedTime) - (b.actualTime || b.plannedTime));

		const future = departures.filter((d) => (d.actualTime || d.plannedTime) >= now);
		return future.slice(0, count);
	}

	_countFutureDepartures(rawStops, changesById, now, categories) {
		return this._mergeAndFilter(rawStops, changesById, categories).filter(
			(d) => (d.actualTime || d.plannedTime) >= now,
		).length;
	}

	_mergeAndFilter(rawStops, changesById, categories) {
		const result = [];
		for (const s of rawStops) {
			const dp = s.dp;
			if (!dp) continue; // nur Ankunft, keine Abfahrt an dieser Station -> für Abfahrtstafel irrelevant
			const tl = s.tl || {};
			const category = tl['@_c'] || '';
			if (categories && !categories.includes(category.toUpperCase())) continue;

			const change = changesById.get(s['@_id']);
			const cdp = change && change.dp;

			const plannedTime = parseIrisTime(dp['@_pt']);
			const actualTime = cdp && cdp['@_ct'] ? parseIrisTime(cdp['@_ct']) : plannedTime;
			const cancelled = !!(cdp && cdp['@_cs'] === 'C');
			const plannedPlatform = dp['@_pp'] || '';
			const platform = (cdp && cdp['@_cp']) || plannedPlatform;
			const path = ((cdp && cdp['@_cpth']) || dp['@_ppth'] || '').split('|').filter(Boolean);
			const destination = path.length ? path[path.length - 1] : '';
			const delayMinutes =
				actualTime && plannedTime ? Math.round((actualTime.getTime() - plannedTime.getTime()) / 60000) : 0;

			result.push({
				id: s['@_id'],
				category,
				number: tl['@_n'] || '',
				owner: tl['@_o'] || '',
				line: dp['@_l'] || `${category}${tl['@_n'] || ''}`,
				destination,
				via: path.slice(0, -1),
				plannedTime,
				actualTime,
				delayMinutes,
				plannedPlatform,
				platform,
				cancelled,
			});
		}
		return result;
	}
}

module.exports = {
	DbTimetablesClient,
	parseIrisTime,
	formatIrisDate,
	formatIrisHour,
	DEFAULT_BASE_URL,
};
