'use strict';
const assert = require('assert');
const { DbTimetablesClient } = require('../lib/dbTimetablesClient');

// Echte Antworten der IRIS-API (/station/{pattern}), gekürzt
const ONE_STATION = `<stations>

<station name="Langenhagen Pferdemarkt" eva="8003542" ds100="HLGH" db="true" creationts="26-09-15 10:38:54.071"/>

</stations>
`;
const NO_STATION = '<stations>\n</stations>\n';

describe('DbTimetablesClient station search', () => {
	let originalFetch;

	function mockResponse(body) {
		global.fetch = async () => ({ ok: true, status: 200, text: async () => body });
	}

	beforeEach(() => {
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('returns the station with name, EVA number and DS100 code', async () => {
		mockResponse(ONE_STATION);
		const result = await new DbTimetablesClient('id', 'key').searchStations('langenhagen');
		assert.deepStrictEqual(result, [{ name: 'Langenhagen Pferdemarkt', eva: '8003542', ds100: 'HLGH' }]);
	});

	it('returns an empty list, not an empty entry, when nothing matches', async () => {
		mockResponse(NO_STATION);
		const result = await new DbTimetablesClient('id', 'key').searchStations('Pferdemarkt');
		assert.deepStrictEqual(result, []);
	});

	it('treats empty plan and change responses as "no data"', async () => {
		mockResponse('<timetable station="X" eva="1">\n</timetable>\n');
		const client = new DbTimetablesClient('id', 'key');
		assert.deepStrictEqual(await client.getPlanHour('1', new Date()), []);
		assert.strictEqual((await client.getChanges('1')).size, 0);
	});
});
