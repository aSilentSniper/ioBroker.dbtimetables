'use strict';
const assert = require('assert');
const { DbTimetablesClient, formatIrisDate, formatIrisHour } = require('../lib/dbTimetablesClient');

// feste "jetzt"-Zeit: 3.9.2026, 17:50 Uhr lokal
const NOW = new Date(2026, 8, 3, 17, 50, 0);

const stationXml = `<stations><station name="Karlsruhe Hbf" eva="8000191" ds100="RK"/><station name="Karlsruhe West" eva="8007433" ds100="RKW"/></stations>`;

function planXmlFor(hour) {
	if (hour === 17) {
		// eine Abfahrt in der Vergangenheit (17:40), eine in der Zukunft (17:55)
		return `<timetable station="Karlsruhe Hbf" eva="8000191">
			<s id="A-17">
				<tl f="N" t="p" o="80" c="S" n="1"/>
				<dp pt="2609031740" pp="1" ppth="Bruchsal"/>
			</s>
			<s id="B-17">
				<tl f="F" t="p" o="80" c="ICE" n="500"/>
				<dp pt="2609031755" pp="3" ppth="Frankfurt(Main)Hbf|Mannheim Hbf"/>
			</s>
			<s id="C-17">
				<tl f="N" t="p" o="80" c="RB" n="99"/>
				<dp pt="2609031758" pp="5" ppth="Rastatt"/>
			</s>
		</timetable>`;
	}
	if (hour === 18) {
		return `<timetable station="Karlsruhe Hbf" eva="8000191">
			<s id="C-17">
				<tl f="N" t="p" o="80" c="RB" n="99"/>
				<dp pt="2609031758" pp="5" ppth="Rastatt"/>
			</s>
			<s id="D-18">
				<tl f="N" t="p" o="80" c="S" n="2"/>
				<dp pt="2609031810" pp="2" ppth="Durlach"/>
			</s>
		</timetable>`;
	}
	return `<timetable station="Karlsruhe Hbf" eva="8000191"></timetable>`;
}

const changesXml = `<timetable station="Karlsruhe Hbf" eva="8000191">
	<s id="B-17" eva="8000191">
		<dp ct="2609031803" cp="4"/>
	</s>
	<s id="C-17" eva="8000191">
		<dp cs="C"/>
	</s>
</timetable>`;

let calls = [];
global.fetch = async (url) => {
	calls.push(url);
	let body = '';
	let status = 200;
	if (url.includes('/station/')) {
		body = stationXml;
	} else if (url.includes('/fchg/')) {
		body = changesXml;
	} else if (url.includes('/plan/')) {
		const hour = parseInt(url.split('/').pop(), 10);
		body = planXmlFor(hour);
	} else {
		status = 404;
	}
	return {
		ok: status === 200,
		status,
		text: async () => body,
	};
};

(async () => {
	const client = new DbTimetablesClient('CID', 'KEY');

	// 1) Stationssuche
	const stations = await client.searchStations('Karlsruhe');
	assert.strictEqual(stations.length, 2);
	assert.strictEqual(stations[0].eva, '8000191');
	assert.strictEqual(stations[0].name, 'Karlsruhe Hbf');
	console.log('searchStations OK:', stations);

	// 2) Datum/Stunde-Formatierung
	assert.strictEqual(formatIrisDate(NOW), '260903');
	assert.strictEqual(formatIrisHour(NOW), '17');
	console.log('formatIrisDate/Hour OK');

	// 3) Abfahrtstafel: 3 gewünschte Abfahrten, ab 17:50 Uhr
	//    -> A-17 (17:40) ist in der Vergangenheit -> raus
	//    -> B-17 verspätet auf 18:03, Gleis 4      -> drin, delay=8
	//    -> C-17 fällt aus (cs=C)                  -> drin (kann optisch markiert werden), planned 17:58
	//    -> D-18 (18:10) aus der 2. Stunden-Slice   -> drin
	calls = [];
	const board = await client.getDepartureBoard('8000191', { count: 3, now: NOW });
	console.log('getDepartureBoard result:', JSON.stringify(board, null, 2));
	console.log('HTTP calls used:', calls);

	assert.strictEqual(board.length, 3, 'sollte genau 3 Abfahrten liefern');
	assert.strictEqual(board[0].id, 'C-17');
	assert.strictEqual(board[0].cancelled, true);
	assert.strictEqual(board[1].id, 'B-17');
	assert.strictEqual(board[1].delayMinutes, 8);
	assert.strictEqual(board[1].platform, '4');
	assert.strictEqual(board[2].id, 'D-18');

	// keine doppelten IDs trotz Überlappung der Stunden-Slices (C-17 kam in Stunde 17 und 18 vor)
	const ids = board.map((d) => d.id);
	assert.strictEqual(new Set(ids).size, ids.length, 'keine Duplikate erwartet');

	// 4) Kategorie-Filter: nur "S"
	const onlyS = await client.getDepartureBoard('8000191', { count: 5, now: NOW, categories: ['S'] });
	console.log('Kategorie-Filter S:', JSON.stringify(onlyS.map((d) => d.id)));
	assert.deepStrictEqual(
		onlyS.map((d) => d.id),
		['D-18'],
	);

	console.log('\nALLE TESTS BESTANDEN');
})().catch((err) => {
	console.error('TEST FEHLGESCHLAGEN:', err);
	process.exit(1);
});
