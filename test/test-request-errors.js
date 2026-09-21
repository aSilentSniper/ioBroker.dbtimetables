'use strict';
const assert = require('assert');
const { DbTimetablesClient } = require('../lib/dbTimetablesClient');

describe('DbTimetablesClient request errors', () => {
	let originalFetch;

	beforeEach(() => {
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('passes an abort signal to fetch so a hanging API cannot block polling', async () => {
		let init;
		global.fetch = async (_url, options) => {
			init = options;
			return { ok: true, status: 200, text: async () => '<stations/>' };
		};
		await new DbTimetablesClient('id', 'key').searchStations('Karlsruhe');
		assert.ok(init.signal instanceof AbortSignal, 'fetch must be called with an AbortSignal');
	});

	it('turns a timeout into a readable error', async () => {
		global.fetch = async () => {
			const err = new Error('The operation was aborted due to timeout');
			err.name = 'TimeoutError';
			throw err;
		};
		const client = new DbTimetablesClient('id', 'key', { timeoutMs: 2000 });
		await assert.rejects(client.searchStations('Karlsruhe'), /Zeitüberschreitung nach 2s/);
	});

	it('reports the real cause of a network failure instead of "fetch failed"', async () => {
		global.fetch = async () => {
			const err = new TypeError('fetch failed');
			err.cause = { code: 'ENOTFOUND' };
			throw err;
		};
		await assert.rejects(new DbTimetablesClient('id', 'key').searchStations('Karlsruhe'), /Netzwerkfehler.*ENOTFOUND/);
	});

	it('includes the response text in authentication errors', async () => {
		global.fetch = async () => ({
			ok: false,
			status: 401,
			text: async () => '{"message":"Invalid API key"}',
		});
		await assert.rejects(
			new DbTimetablesClient('id', 'key').searchStations('Karlsruhe'),
			/Authentifizierung fehlgeschlagen \(HTTP 401\).*Invalid API key/,
		);
	});
});
