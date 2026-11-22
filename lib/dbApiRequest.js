'use strict';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Führt einen Request gegen eine API des DB API Marketplace aus und liefert den rohen Antworttext.
 * Wandelt Timeouts, Netzwerk- und HTTP-Fehler in lesbare Fehlermeldungen um.
 *
 * @param {string} url vollständige URL
 * @param {object} options Einstellungen
 * @param {string} options.clientId DB-Client-Id
 * @param {string} options.apiKey DB-Api-Key
 * @param {string} options.label Kurzbezeichnung des Requests für Fehlermeldungen (z.B. der API-Pfad)
 * @param {string} [options.method] HTTP-Methode (Standard: GET)
 * @param {string} [options.accept] Accept-Header
 * @param {object} [options.body] JSON-Body (nur bei POST)
 * @param {number} [options.timeoutMs] Timeout in Millisekunden (Standard: {@link DEFAULT_TIMEOUT_MS})
 * @param {(msg: string) => void} [options.debug] optionaler Logger für Debug-Ausgaben
 * @returns {Promise<string>} der Antworttext
 */
async function dbApiRequest(url, options) {
	const method = options.method || 'GET';
	const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
	const debug = options.debug || (() => {});
	const label = options.label;
	const headers = {
		'DB-Client-Id': options.clientId,
		'DB-Api-Key': options.apiKey,
	};
	if (options.accept) {
		headers.Accept = options.accept;
	}
	const init = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
	if (options.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		init.body = JSON.stringify(options.body);
	}

	debug(`${method} ${url}${init.body ? ` ${init.body}` : ''}`);
	let res;
	let text;
	try {
		res = await fetch(url, init);
		debug(`${method} ${url} -> HTTP ${res.status}`);
		text = await res.text();
	} catch (err) {
		if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
			throw new Error(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)}s für ${label}`);
		}
		// Node meldet Netzwerkfehler nur als "fetch failed", der eigentliche Grund steckt in err.cause
		const cause = err && err.cause && (err.cause.code || err.cause.message);
		throw new Error(`Netzwerkfehler für ${label}: ${cause || (err && err.message) || err}`);
	}
	if (!res.ok) {
		const detail = describeErrorBody(text);
		if (res.status === 401 || res.status === 403) {
			throw new Error(
				`Authentifizierung fehlgeschlagen (HTTP ${res.status}) - Client-Id/API-Key und Abo der API prüfen${detail ? `: ${detail}` : ''}`,
			);
		}
		if (res.status === 404) {
			throw new Error(`Nicht gefunden (HTTP 404) für ${label}`);
		}
		if (res.status === 429) {
			throw new Error('Rate-Limit erreicht (HTTP 429) - Aktualisierungsintervall erhöhen');
		}
		throw new Error(`HTTP ${res.status} für ${label}${detail ? `: ${detail}` : ''}`);
	}
	return text;
}

/**
 * Holt aus einer Fehlerantwort den aussagekräftigen Teil. Die APIs liefern je nach Fehler
 * JSON ({"detail": ...}), XML (<moreInformation>...</moreInformation>) oder Freitext.
 *
 * @param {string} text Antworttext
 * @returns {string} gekürzte Fehlerbeschreibung (leer, wenn keine vorhanden)
 */
function describeErrorBody(text) {
	const trimmed = (text || '').trim();
	if (!trimmed) {
		return '';
	}
	try {
		const obj = JSON.parse(trimmed);
		if (obj && typeof obj === 'object') {
			const msg = obj.detail || obj.moreInformation || obj.message || obj.title;
			if (msg) {
				return String(msg).slice(0, 200);
			}
		}
	} catch {
		// kein JSON
	}
	const xmlInfo = trimmed.match(/<moreInformation>([^<]*)<\/moreInformation>/);
	if (xmlInfo) {
		return xmlInfo[1].trim().slice(0, 200);
	}
	return trimmed.slice(0, 200);
}

module.exports = { dbApiRequest, describeErrorBody, DEFAULT_TIMEOUT_MS };
