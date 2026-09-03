'use strict';
const { XMLParser } = require('fast-xml-parser');

const planXml = `<timetable station="Karlsruhe Hbf" eva="8000191">
<s id="1299917288606705699-2304081716-12">
    <tl f="F" t="p" o="80" c="ICE" n="273"/>
    <ar pt="2609031716" pp="2" ppth="Berlin Hbf|Leipzig Hbf|Erfurt Hbf"/>
    <dp pt="2609031719" pp="2" ppth="Baden-Baden|Offenburg|Freiburg(Breisgau) Hbf"/>
</s>
<s id="9999999999999999-2609031720-1">
    <tl f="N" t="p" o="80" c="RE" n="4711"/>
    <dp pt="2609031725" pp="7" ppth="Bruchsal|Heidelberg Hbf"/>
</s>
</timetable>`;

const changeXml = `<timetable station="Karlsruhe Hbf" eva="8000191">
<s id="1299917288606705699-2304081716-12" eva="8000191">
    <ar ct="2609031722" cp="3"/>
    <dp ct="2609031726" cp="3">
        <m id="r1" t="d" c="51" ts="2609031600"/>
    </dp>
</s>
</timetable>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['s', 'm'].includes(name),
});

function toArr(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseIrisTime(t) {
  // format yyMMddHHmm
  if (!t || t.length !== 10) return null;
  const yy = parseInt(t.slice(0, 2), 10);
  const MM = parseInt(t.slice(2, 4), 10);
  const dd = parseInt(t.slice(4, 6), 10);
  const HH = parseInt(t.slice(6, 8), 10);
  const mm = parseInt(t.slice(8, 10), 10);
  return new Date(2000 + yy, MM - 1, dd, HH, mm, 0, 0);
}

const planObj = parser.parse(planXml);
const changeObj = parser.parse(changeXml);

const changesById = new Map();
for (const s of toArr(changeObj.timetable.s)) {
  changesById.set(s['@_id'], s);
}

const departures = [];
for (const s of toArr(planObj.timetable.s)) {
  const dp = s.dp;
  if (!dp) continue; // no departure at this stop -> arrival only, skip for a departure board
  const tl = s.tl || {};
  const change = changesById.get(s['@_id']);
  const cdp = change && change.dp;

  const plannedTime = parseIrisTime(dp['@_pt']);
  const actualTime = cdp && cdp['@_ct'] ? parseIrisTime(cdp['@_ct']) : plannedTime;
  const cancelled = !!(cdp && cdp['@_cs'] === 'C');
  const platform = (cdp && cdp['@_cp']) || dp['@_pp'] || '';
  const plannedPlatform = dp['@_pp'] || '';
  const path = ((cdp && cdp['@_cpth']) || dp['@_ppth'] || '').split('|').filter(Boolean);
  const destination = path.length ? path[path.length - 1] : '';
  const delayMin = actualTime && plannedTime ? Math.round((actualTime - plannedTime) / 60000) : 0;

  departures.push({
    id: s['@_id'],
    category: tl['@_c'] || '',
    number: tl['@_n'] || '',
    line: dp['@_l'] || `${tl['@_c'] || ''}${tl['@_n'] || ''}`,
    destination,
    plannedTime,
    actualTime,
    delayMin,
    plannedPlatform,
    platform,
    cancelled,
  });
}

departures.sort((a, b) => (a.actualTime || a.plannedTime) - (b.actualTime || b.plannedTime));

console.log(JSON.stringify(departures, null, 2));

// sanity checks
const ice = departures.find((d) => d.category === 'ICE');
console.assert(ice.delayMin === 7, 'ICE delay should be 7 minutes, got ' + ice.delayMin);
console.assert(ice.platform === '3', 'ICE platform should be changed to 3, got ' + ice.platform);
console.assert(ice.destination === 'Freiburg(Breisgau) Hbf', 'destination wrong: ' + ice.destination);
const re = departures.find((d) => d.category === 'RE');
console.assert(re.delayMin === 0, 'RE should have no delay (no change entry)');
console.assert(departures[0].category === 'RE', 'sort order wrong: RE (17:25) should come before ICE (17:26 actual)');
console.log('OK - alle Checks bestanden');
