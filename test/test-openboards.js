'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { OpenBoardsClient, MAX_ENTRIES_PER_TRANSPORT_TYPE } = require('../lib/openBoardsClient');

// Echte Antworten vom 22.11.2026: OpenBoards /departures für Hannover Hbf (8000152), abgefragt um ca. 17:15 Uhr,
// und OpenStation-Suchen (NeTEx, gekürzt auf die Stationsdaten)
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const HANNOVER = JSON.parse(fixture('openboards-departures-hannover.json'));
const NOW = new Date('2026-11-22T17:15:00+01:00');

function jsonResponse(obj, status = 200) {
	return { ok: status < 400, status, text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) };
}

describe('OpenBoardsClient departure board', () => {
	let originalFetch;
	let calls;

	function mockFetch(handler) {
		calls = [];
		global.fetch = async (url, init) => {
			const body = init && init.body ? JSON.parse(init.body) : undefined;
			calls.push({ url, init, body });
			return handler(url, body, calls.length);
		};
	}

	beforeEach(() => {
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('maps a real response to the same departure format the Timetables client returns', async () => {
		mockFetch(() => jsonResponse(HANNOVER));
		const board = await new OpenBoardsClient('id', 'key').getDepartureBoard('8000152', { count: 5, now: NOW });

		assert.deepStrictEqual(
			board.map(d => `${d.line} ${d.destination}`),
			['RE60 Rheine', 'RE1 Bremen Hbf', 'S2 Haste', 'S5 Hameln', 'ICE883 München Hbf'],
		);
		const re60 = board[0];
		assert.strictEqual(re60.id, '20261122-3ecd04a0-8f31-3b41-b346-aff4f7348462');
		assert.strictEqual(re60.category, 'WFB');
		assert.strictEqual(re60.number, '95782');
		assert.strictEqual(re60.owner, 'WestfalenBahn');
		assert.strictEqual(re60.plannedTime.getTime(), new Date('2026-11-22T17:09:00+01:00').getTime());
		assert.strictEqual(re60.actualTime.getTime(), new Date('2026-11-22T17:18:00+01:00').getTime());
		assert.strictEqual(re60.delayMinutes, 9);
		assert.strictEqual(re60.plannedPlatform, '10');
		assert.strictEqual(re60.platform, '11');
		assert.strictEqual(re60.cancelled, false);
		assert.strictEqual(re60.mode, 'train');
		assert.deepStrictEqual(re60.via, ['Wunstorf', 'Minden(Westf)', 'Osnabrück Hbf']);

		const s5 = board[3];
		assert.strictEqual(s5.cancelled, true);
		// ICE haben keine Linie, der Name wird wie bisher aus Gattung und Nummer gebildet
		assert.strictEqual(board[4].line, 'ICE883');
		assert.strictEqual(board[4].owner, 'DB Fernverkehr AG');
	});

	it('sends the documented request with a working Accept header', async () => {
		mockFetch(() => jsonResponse(HANNOVER));
		await new OpenBoardsClient('cid', 'secret').getDepartureBoard('8000152', { count: 3, now: NOW });

		assert.strictEqual(calls.length, 1, 'enough departures in the first window -> only one API call');
		const { url, init, body } = calls[0];
		assert.strictEqual(url, 'https://apis.deutschebahn.com/db-api-marketplace/apis/open-boards/v1/departures');
		assert.strictEqual(init.method, 'POST');
		assert.strictEqual(init.headers['DB-Client-Id'], 'cid');
		assert.strictEqual(init.headers['DB-Api-Key'], 'secret');
		// "application/vnd.de.db.ris+json" aus der Doku führt zu HTTP 406
		assert.strictEqual(init.headers.Accept, 'application/json');
		assert.deepStrictEqual(body.stopPlaceOrStation, { evaNumbers: ['8000152'] });
		assert.strictEqual(body.maxEntriesPerTransportType, MAX_ENTRIES_PER_TRANSPORT_TYPE);
		assert.strictEqual(new Date(body.timeWindow.timeStart).getTime(), NOW.getTime());
		assert.strictEqual(new Date(body.timeWindow.timeEnd).getTime() - NOW.getTime(), 3600 * 1000);
		assert.ok(!('entryCount' in body.timeWindow), 'entryCount is rejected by the API ("not yet supported")');
	});

	it('widens the time window until enough departures are found, at most 8 hours', async () => {
		mockFetch((_url, _body, n) => jsonResponse(n < 3 ? { departures: [] } : HANNOVER));
		const board = await new OpenBoardsClient('id', 'key').getDepartureBoard('8000152', { count: 2, now: NOW });

		assert.strictEqual(calls.length, 3);
		const hours = calls.map(c => (new Date(c.body.timeWindow.timeEnd) - NOW) / 3600000);
		assert.deepStrictEqual(hours, [1, 3, 8]);
		assert.strictEqual(board.length, 2);
	});

	it('filters by category and by the letters of the line, so "RE" also finds private operators', async () => {
		mockFetch(() => jsonResponse(HANNOVER));
		const board = await new OpenBoardsClient('id', 'key').getDepartureBoard('8000152', {
			count: 10,
			categories: ['re'],
			now: NOW,
		});
		assert.deepStrictEqual(
			board.map(d => `${d.category}:${d.line}`),
			['WFB:RE60', 'RE:RE1', 'RE:RE2', 'ME:RE3'],
		);
	});

	it('skips departures in the past and from other stops of the transfer area', async () => {
		const other = JSON.parse(JSON.stringify(HANNOVER.departures[1]));
		other.evaNumber = '628410';
		other.journeyId = 'bus';
		mockFetch(() => jsonResponse({ ...HANNOVER, departures: [...HANNOVER.departures, other] }));
		const board = await new OpenBoardsClient('id', 'key').getDepartureBoard('8000152', {
			count: 50,
			now: new Date('2026-11-22T17:40:00+01:00'),
		});
		assert.ok(board.every(d => d.id !== 'bus'));
		assert.ok(board.every(d => d.actualTime >= new Date('2026-11-22T17:40:00+01:00')));
		assert.strictEqual(board[0].line, 'S4');
	});

	it('does not show departures beyond the point where the API truncated the list', async () => {
		// angenommen, die API hätte die S-Bahnen nach 17:28 abgeschnitten: danach könnten S-Bahnen fehlen
		const departures = HANNOVER.departures.filter(
			d => d.transport.type !== 'CITY_TRAIN' || new Date(d.time) <= new Date('2026-11-22T17:28:00+01:00'),
		);
		mockFetch(() =>
			jsonResponse({ ...HANNOVER, departures, meta: { truncatedTransportTypes: ['CITY_TRAIN'] } }),
		);
		const board = await new OpenBoardsClient('id', 'key').getDepartureBoard('8000152', { count: 50, now: NOW });

		assert.strictEqual(calls.length, 1, 'a truncated answer cannot get better with a wider window');
		assert.strictEqual(board.at(-1).line, 'S1');
		assert.ok(board.every(d => d.actualTime <= new Date('2026-11-22T17:28:00+01:00')));
	});

	it('shows coupled trains as one departure, like the boards on the platform', async () => {
		// Karlsruhe Hbf, 22.11.2026 ab 18:00: ICE 1069 und ICE 2831 fahren gekoppelt nach München,
		// bei ICE 2831 fehlt direction, das Ziel kommt dort aus journeyInfo.destination
		mockFetch(() => jsonResponse(fixture('openboards-departures-karlsruhe.json')));
		const board = await new OpenBoardsClient('id', 'key').getDepartureBoard('8000191', {
			count: 50,
			categories: ['ICE'],
			now: new Date('2026-11-22T18:00:00+01:00'),
		});
		const munich = board.filter(d => d.destination.includes('München'));
		assert.strictEqual(munich.length, 1);
		assert.strictEqual(munich[0].line, 'ICE1069 / ICE2831');
		assert.strictEqual(munich[0].number, '1069 / 2831');
		assert.strictEqual(munich[0].destination, 'München Hbf');
		assert.strictEqual(munich[0].platform, '9');
	});

	it('explains a missing OpenBoards subscription', async () => {
		mockFetch(() =>
			jsonResponse(
				'<?xml version="1.0" encoding="UTF-8"?><errorResponse><httpCode>401</httpCode><httpMessage>Unauthorized</httpMessage><moreInformation>Cannot find valid subscription for the incoming API request.</moreInformation></errorResponse>',
				401,
			),
		);
		await assert.rejects(
			new OpenBoardsClient('id', 'key').getDepartureBoard('8000152', { now: NOW }),
			/Authentifizierung fehlgeschlagen \(HTTP 401\).*Abo.*Cannot find valid subscription/,
		);
	});

	it('shows the reason of a rejected request', async () => {
		mockFetch(() =>
			jsonResponse(
				{
					detail: "'timeEnd' must not be more than 8 hours after 'timeStart'",
					status: '400',
					title: 'NOT_SUPPORTED_REQUEST_PARAMETER',
				},
				400,
			),
		);
		await assert.rejects(
			new OpenBoardsClient('id', 'key').getDepartureBoard('8000152', { now: NOW }),
			/HTTP 400 .*must not be more than 8 hours/,
		);
	});
});

describe('OpenBoardsClient station search (OpenStation)', () => {
	let originalFetch;
	let urls;

	function mockFetch(handler) {
		urls = [];
		global.fetch = async (url, init) => {
			urls.push(url);
			return handler(url, init);
		};
	}

	beforeEach(() => {
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('finds a station by a part of its name', async () => {
		mockFetch(() => jsonResponse(fixture('openstation-pferdemarkt.xml')));
		const result = await new OpenBoardsClient('id', 'key').searchStations(' Pferdemarkt ');

		assert.deepStrictEqual(result, [{ name: 'Langenhagen Pferdemarkt', eva: '8003542', ds100: 'HLGH' }]);
		const url = new URL(urls[0]);
		assert.strictEqual(url.pathname, '/db-api-marketplace/apis/open-station/v1/netex');
		assert.strictEqual(url.searchParams.get('stopPlaceName'), 'Pferdemarkt');
		assert.strictEqual(url.searchParams.get('includeSitePathLinks'), 'false');
	});

	it('lists the shortest matching names first, so the main station is on top', async () => {
		mockFetch(() => jsonResponse(fixture('openstation-hannover.xml')));
		const result = await new OpenBoardsClient('id', 'key').searchStations('hannover');

		assert.strictEqual(result.length, 12);
		assert.deepStrictEqual(result[0], { name: 'Hannover Hbf', eva: '8000152', ds100: 'HH' });
	});

	it('returns an empty list when nothing matches', async () => {
		mockFetch(() =>
			jsonResponse(
				'<?xml version="1.0"?><PublicationDelivery xmlns="http://www.netex.org.uk/netex"><dataObjects><CompositeFrame><frames><SiteFrame><stopPlaces></stopPlaces></SiteFrame></frames></CompositeFrame></dataObjects></PublicationDelivery>',
			),
		);
		assert.deepStrictEqual(await new OpenBoardsClient('id', 'key').searchStations('xyzzy'), []);
	});

	it('does not call the API for an empty search', async () => {
		mockFetch(() => assert.fail('no request expected'));
		assert.deepStrictEqual(await new OpenBoardsClient('id', 'key').searchStations('  '), []);
	});

	it('looks up a 7-digit EVA number via OpenBoards, because OpenStation only searches names', async () => {
		mockFetch(() => jsonResponse(HANNOVER));
		const result = await new OpenBoardsClient('id', 'key').searchStations('8000152');

		assert.deepStrictEqual(result, [{ name: 'Hannover Hbf', eva: '8000152', ds100: '' }]);
		assert.ok(urls[0].endsWith('/open-boards/v1/departures'));
	});
});
