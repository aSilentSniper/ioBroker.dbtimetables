'use strict';

const utils = require('@iobroker/adapter-core');
const { DbTimetablesClient } = require('./lib/dbTimetablesClient');

// Spalten-Überschriften der HTML-Tabelle, wie im alten ioBroker.fahrplan (lib/deptt.js)
const HTML_HEADER = {
	de: '<tr><th align="center">Zeit</th><th align="left">Richtung</th><th align="center">Plattform</th><th align="center">Verspätung</th><th align="center">Typ</th></tr>',
	en: '<tr><th align="center">Time</th><th align="left">Direction</th><th align="center">Platform</th><th align="center">Delay</th><th align="center">Type</th></tr>',
};

class Dbtimetables extends utils.Adapter {
	constructor(options) {
		super({ ...options, name: 'dbtimetables' });
		this.on('ready', this.onReady.bind(this));
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.pollTimer = null;
		this.client = null;
		this.entries = [];
	}

	async onReady() {
		if (!this.config.clientId || !this.config.apiKey) {
			this.log.error(
				'DB-Client-Id und/oder DB-Api-Key fehlen in der Adapterkonfiguration. Bitte in den Instanzeinstellungen eintragen.',
			);
			await this.setStateAsync('info.connection', false, true);
			return;
		}

		this.client = new DbTimetablesClient(this.config.clientId, this.config.apiKey, {
			debug: (msg) => this.log.debug(msg),
		});

		// komplette, konfigurierte Liste (auch deaktivierte Zeilen), Reihenfolge = Index = "Nr" wie im alten Adapter
		this.entries = this.config.stations || [];
		if (!this.entries.length) {
			this.log.warn('Keine Station konfiguriert - Adapter tut nichts.');
		}

		await this.setupObjects();

		const intervalSec = Math.max(20, Number(this.config.pollInterval) || 60);
		await this.pollAll();
		this.pollTimer = this.setInterval(() => this.pollAll(), intervalSec * 1000);
	}

	onUnload(callback) {
		try {
			if (this.pollTimer) this.clearInterval(this.pollTimer);
			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Erlaubt eine Stationssuche per sendTo, z.B. aus einem Skript:
	 * sendTo('dbtimetables.0', 'searchStation', { pattern: 'Karlsruhe' }, result => console.log(result));
	 */
	onMessage(obj) {
		if (!obj || !obj.command) return;
		if (obj.command === 'searchStation') {
			(async () => {
				try {
					if (!this.client && this.config.clientId && this.config.apiKey) {
						this.client = new DbTimetablesClient(this.config.clientId, this.config.apiKey, {
							debug: (msg) => this.log.debug(msg),
						});
					}
					if (!this.client) throw new Error('Client-Id/API-Key nicht konfiguriert');
					const pattern = (obj.message && obj.message.pattern) || '';
					const result = await this.client.searchStations(pattern);
					if (obj.callback) this.sendTo(obj.from, obj.command, { result }, obj.callback);
				} catch (err) {
					if (obj.callback) this.sendTo(obj.from, obj.command, { error: err.message }, obj.callback);
				}
			})();
		}
	}

	// ---------------------------------------------------------------------
	// Objektaufbau - Namensschema bewusst identisch zu ioBroker.fahrplan
	// (lib/deptt.js, lib/depttdep.js, lib/line.js, lib/station.js), damit
	// bestehende VIS-Bindings/Skripte nur den Instanznamen anpassen müssen.
	// ---------------------------------------------------------------------

	async setupObjects() {
		for (let index = 0; index < this.entries.length; index++) {
			const entry = this.entries[index];
			const base = `DepartureTimetable${index}`;

			// .Enabled wird immer geschrieben, auch für deaktivierte Zeilen (wie im Original)
			await this.setObjectNotExistsAsync(`${base}.Enabled`, {
				type: 'state',
				common: { name: `Configuration State of Departure Timetable #${index}`, type: 'boolean', role: 'indicator', read: true, write: false, def: false },
				native: {},
			});

			if (!entry || !entry.active || !entry.evaNo) continue;

			await this.setObjectNotExistsAsync(base, {
				type: 'channel',
				common: { name: `Departure Timetable #${index} - ${entry.name || entry.evaNo}` },
				native: { evaNo: entry.evaNo },
			});
			await this.extendObjectAsync(base, { native: { evaNo: entry.evaNo } });

			// Unterkanal .Station - wie im Original (lib/station.js writeStation)
			await this.setObjectNotExistsAsync(`${base}.Station`, {
				type: 'channel',
				common: { name: entry.name || entry.evaNo, desc: 'Station' },
				native: {},
			});
			const stationFields = {
				Name: 'Station Name',
				eBhf: 'Station eBhf (EVA-Nummer)',
				CustomName: 'Station Custom Name',
				Type: 'Station Type',
			};
			for (const [key, name] of Object.entries(stationFields)) {
				await this.setObjectNotExistsAsync(`${base}.Station.${key}`, {
					type: 'state',
					common: { name, type: 'string', role: 'state', read: true, write: false, def: '' },
					native: {},
				});
			}
			await this.setObjectNotExistsAsync(`${base}.Station.JSON`, {
				type: 'state',
				common: { name: 'Station JSON', type: 'string', role: 'json', read: true, write: false, def: '' },
				native: {},
			});

			await this.setObjectNotExistsAsync(`${base}.JSON`, {
				type: 'state',
				common: { name: 'Departure Timetable JSON', type: 'string', role: 'json', read: true, write: false, def: '' },
				native: {},
			});
			await this.setObjectNotExistsAsync(`${base}.HTML`, {
				type: 'state',
				common: { name: 'HTML', type: 'string', role: 'html', read: true, write: false, def: '' },
				native: {},
			});

			const count = Math.max(1, Number(entry.count) || 3);
			for (let i = 0; i < count; i++) {
				await this.setupDepartureObjects(base, i);
			}
			await this.cleanupExtraDepartureObjects(base, count);
		}
	}

	async setupDepartureObjects(base, depIndex) {
		const path = `${base}.${depIndex}`;
		await this.setObjectNotExistsAsync(path, {
			type: 'channel',
			common: { name: `Departure ${depIndex}` },
			native: {},
		});
		await this.setObjectNotExistsAsync(`${path}.JSON`, {
			type: 'state',
			common: { name: 'Departure JSON', type: 'string', role: 'json', read: true, write: false, def: '' },
			native: {},
		});
		await this.setObjectNotExistsAsync(`${path}.Departure`, {
			type: 'state',
			common: { name: 'Departure', type: 'number', role: 'date', read: true, write: false, def: 0 },
			native: {},
		});
		await this.setObjectNotExistsAsync(`${path}.DeparturePlanned`, {
			type: 'state',
			common: { name: 'DeparturePlanned', type: 'number', role: 'date', read: true, write: false, def: 0 },
			native: {},
		});
		await this.setObjectNotExistsAsync(`${path}.DepartureDelaySeconds`, {
			type: 'state',
			common: { name: 'DepartureDelaySeconds', type: 'number', role: 'value', read: true, write: false, def: 0 },
			native: {},
		});
		await this.setObjectNotExistsAsync(`${path}.DepartureOnTime`, {
			type: 'state',
			common: { name: 'DepartureOnTime', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
			native: {},
		});
		await this.setObjectNotExistsAsync(`${path}.DepartureDelayed`, {
			type: 'state',
			common: { name: 'DepartureDelayed', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
			native: {},
		});
		// zusätzlich zum Original: Ausfall-Flag (IRIS liefert das, HAFAS-Version der Abfahrtstafel hatte es nicht)
		await this.setObjectNotExistsAsync(`${path}.Cancelled`, {
			type: 'state',
			common: {
				name: 'Cancelled (Zusatzfeld, gab es im alten Adapter nicht)',
				type: 'boolean',
				role: 'indicator',
				read: true,
				write: false,
				def: false,
			},
			native: {},
		});
		const lineFields = {
			Name: 'Line Name',
			Direction: 'Line Direction',
			Mode: 'Line Mode',
			Operator: 'Line Operator',
			Product: 'Line Product',
			Platform: 'Line Platform',
			PlannedPlatform: 'Line PlannedPlatform',
		};
		for (const [key, name] of Object.entries(lineFields)) {
			await this.setObjectNotExistsAsync(`${path}.${key}`, {
				type: 'state',
				common: { name, type: 'string', role: 'state', read: true, write: false, def: '' },
				native: {},
			});
		}
	}

	/** Löscht überzählige Abfahrts-Kanäle, wenn die konfigurierte Anzahl reduziert wurde. */
	async cleanupExtraDepartureObjects(base, count) {
		let i = count;
		let checked = 0;
		while (checked < 50) {
			const path = `${base}.${i}`;
			const obj = await this.getObjectAsync(path);
			if (!obj) break;
			await this.delObjectAsync(path, { recursive: true });
			i++;
			checked++;
		}
	}

	// ---------------------------------------------------------------------
	// Polling
	// ---------------------------------------------------------------------

	async pollAll() {
		for (let index = 0; index < this.entries.length; index++) {
			const entry = this.entries[index];
			if (!entry || !entry.active || !entry.evaNo) continue;
			try {
				await this.pollEntry(entry, index);
			} catch (err) {
				this.log.error(`Fehler bei Departure Timetable #${index} (${entry.name || entry.evaNo}): ${err.message}`);
				await this.setStateAsync('info.connection', false, true).catch(() => {});
			}
		}
	}

	async pollEntry(entry, index) {
		const base = `DepartureTimetable${index}`;
		const count = Math.max(1, Number(entry.count) || 3);
		const categories = (entry.categories || '')
			.split(',')
			.map((c) => c.trim())
			.filter(Boolean);
		const delayThresholdSec = Math.max(0, Number(this.config.delayMinutesThreshold) || 2) * 60;
		const offsetMinutes = Math.max(0, Number(entry.timeOffsetMinutes) || 0);
		const now = new Date(Date.now() + offsetMinutes * 60000);

		const departures = await this.client.getDepartureBoard(entry.evaNo, {
			count,
			categories: categories.length ? categories : null,
			now,
		});

		await this.setStateAsync('info.connection', true, true);
		await this.setStateAsync(`${base}.Enabled`, true, true);

		await this.setStateAsync(`${base}.Station.Name`, entry.name || entry.evaNo, true);
		await this.setStateAsync(`${base}.Station.eBhf`, String(entry.evaNo), true);
		await this.setStateAsync(`${base}.Station.CustomName`, entry.name || entry.evaNo, true);
		await this.setStateAsync(`${base}.Station.Type`, 'station', true);
		if (this.config.saveJson !== false) {
			await this.setStateAsync(`${base}.Station.JSON`, JSON.stringify({ eva: entry.evaNo, name: entry.name }), true);
		}

		if (this.config.saveJson !== false) {
			await this.setStateAsync(`${base}.JSON`, JSON.stringify(departures), true);
		}
		await this.setStateAsync(`${base}.HTML`, this.buildHtml(entry, departures, delayThresholdSec), true);

		for (let i = 0; i < count; i++) {
			const dep = departures[i];
			const path = `${base}.${i}`;
			if (!dep) {
				await this.clearDeparture(path);
				continue;
			}
			await this.writeDeparture(path, dep, delayThresholdSec);
		}
	}

	async writeDeparture(path, dep, delayThresholdSec) {
		const delaySeconds = dep.delayMinutes >= 0 ? dep.delayMinutes * 60 : 0;
		// Logik 1:1 wie im Original (lib/depttdep.js parse()): "OnTime" nur bei exakt 0 Verspätung,
		// "Delayed" erst ab dem konfigurierten Schwellwert - dazwischen ist beides false.
		let onTime = false;
		let delayed = false;
		if (dep.delayMinutes >= 0) {
			if (delaySeconds === 0) onTime = true;
			else if (delaySeconds >= delayThresholdSec) delayed = true;
		}

		if (this.config.saveJson !== false) {
			await this.setStateAsync(`${path}.JSON`, JSON.stringify(dep), true);
		}
		await this.setStateAsync(`${path}.Departure`, dep.actualTime ? dep.actualTime.getTime() : 0, true);
		await this.setStateAsync(`${path}.DeparturePlanned`, dep.plannedTime ? dep.plannedTime.getTime() : 0, true);
		await this.setStateAsync(`${path}.DepartureDelaySeconds`, delaySeconds, true);
		await this.setStateAsync(`${path}.DepartureOnTime`, onTime, true);
		await this.setStateAsync(`${path}.DepartureDelayed`, delayed, true);
		await this.setStateAsync(`${path}.Cancelled`, !!dep.cancelled, true);
		await this.setStateAsync(`${path}.Name`, dep.line, true);
		await this.setStateAsync(`${path}.Direction`, dep.destination, true);
		await this.setStateAsync(`${path}.Mode`, this.guessMode(dep.category), true);
		// IRIS liefert nur den numerischen EVU-Code, keinen Klarnamen (anders als HAFAS)
		await this.setStateAsync(`${path}.Operator`, dep.owner || '', true);
		await this.setStateAsync(`${path}.Product`, dep.category, true);
		await this.setStateAsync(`${path}.Platform`, dep.platform, true);
		await this.setStateAsync(`${path}.PlannedPlatform`, dep.plannedPlatform, true);

		await this.extendObjectAsync(path, { common: { name: dep.line || `Departure` } }).catch(() => {});
	}

	async clearDeparture(path) {
		await this.setStateAsync(`${path}.JSON`, '', true);
		await this.setStateAsync(`${path}.Departure`, 0, true);
		await this.setStateAsync(`${path}.DeparturePlanned`, 0, true);
		await this.setStateAsync(`${path}.DepartureDelaySeconds`, 0, true);
		await this.setStateAsync(`${path}.DepartureOnTime`, false, true);
		await this.setStateAsync(`${path}.DepartureDelayed`, false, true);
		await this.setStateAsync(`${path}.Cancelled`, false, true);
		await this.setStateAsync(`${path}.Name`, '', true);
		await this.setStateAsync(`${path}.Direction`, '', true);
		await this.setStateAsync(`${path}.Mode`, '', true);
		await this.setStateAsync(`${path}.Operator`, '', true);
		await this.setStateAsync(`${path}.Product`, '', true);
		await this.setStateAsync(`${path}.Platform`, '', true);
		await this.setStateAsync(`${path}.PlannedPlatform`, '', true);
	}

	/** Grobe Näherung an HAFAS' abstraktes "mode"-Feld, das IRIS nicht kennt. */
	guessMode(category) {
		const c = (category || '').toUpperCase();
		if (c === 'BUS') return 'bus';
		if (c === 'STR' || c === 'TRAM') return 'tram';
		return 'train';
	}

	fmtTime(date) {
		if (!date) return '';
		return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
	}

	buildHtml(entry, departures, delayThresholdSec) {
		const colorOnTime = this.config.colorOnTime || '#008000';
		const colorDelay = this.config.colorDelay || '#ff0000';
		const lang = ['de', 'en'].includes(this.language) ? this.language : 'de';
		let html = `<table><tr><th align="left" colspan="5">${this.esc(entry.name || entry.evaNo)}</th></tr>`;
		html += HTML_HEADER[lang];
		for (const dep of departures) {
			const delaySeconds = dep.delayMinutes >= 0 ? dep.delayMinutes * 60 : 0;
			const onTime = dep.delayMinutes === 0;
			const delayed = dep.delayMinutes >= 0 && delaySeconds >= delayThresholdSec;
			const timeStr = this.fmtTime(dep.actualTime);
			let row = '<tr>';
			if (onTime) row += `<td><font color="${colorOnTime}">${timeStr}</font></td>`;
			else if (delayed || dep.cancelled) row += `<td><font color="${colorDelay}">${timeStr}</font></td>`;
			else row += `<td>${timeStr}</td>`;
			row += `<td>${this.esc(dep.destination)}${dep.cancelled ? ` (${lang === 'de' ? 'Ausfall' : 'cancelled'})` : ''}</td>`;
			if (!dep.platform) row += '<td>-</td>';
			else if (dep.platform === dep.plannedPlatform) row += `<td><font color="${colorOnTime}">${this.esc(dep.platform)}</font></td>`;
			else row += `<td><font color="${colorDelay}">${this.esc(dep.platform)}</font></td>`;
			const delayMin = Math.max(0, dep.delayMinutes || 0);
			if (onTime) row += `<td><font color="${colorOnTime}">${delayMin}</font></td>`;
			else if (delayed) row += `<td><font color="${colorDelay}">${delayMin}</font></td>`;
			else row += `<td>${delayMin}</td>`;
			row += `<td>${this.esc(dep.category)}</td>`;
			row += '</tr>';
			html += row;
		}
		html += '</table>';
		return html;
	}

	esc(str) {
		const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
		return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => map[c]);
	}
}

if (require.main !== module) {
	module.exports = (options) => new Dbtimetables(options);
} else {
	new Dbtimetables();
}
