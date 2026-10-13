// Delad kod för API-funktionerna. Filer som börjar med _ blir inga egna adresser på Vercel.

const TZ = 'Europe/Stockholm';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ---------- Tid (Stockholm) ----------
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function parts(ms) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

function tzOffset(ms) {
  const s = Math.floor(ms / 1000) * 1000;
  const p = parts(s);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - s;
}

// "2026-10-13T07:40:00" (svensk lokaltid) -> millisekunder
export function localToMs(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let ms = guess - tzOffset(guess);
  ms = guess - tzOffset(ms);
  return ms;
}

// millisekunder -> "2026-10-13T07:40:00.000+02:00" (svensk tid med offset), för Trafikverket
export function msToIso(ms) {
  const p = parts(ms);
  const off = Math.round(tzOffset(ms) / MIN);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000${sign}${hh}:${mm}`;
}

// millisekunder -> "2026-10-13T07:40" (svensk lokaltid), för Trafiklabs tidsparameter
export function msToParam(ms) {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// ---------- Enkel cache i minnet ----------
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttl });
  return val;
}

// ---------- PIN ----------
export function checkPin(req, res) {
  const pin = process.env.APP_PIN;
  if (!pin) return true;
  if (req.headers['x-app-pin'] === pin) return true;
  res.status(401).json({ error: 'Fel eller saknad PIN-kod.' });
  return false;
}

// ---------- Trafiklab Realtime ----------
const TL = 'https://realtime-api.trafiklab.se/v1';

async function tlGet(path) {
  const key = process.env.TRAFIKLAB_KEY;
  if (!key) throw new Error('TRAFIKLAB_KEY saknas i Vercels inställningar.');
  const url = `${TL}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Trafiklab svarade ${r.status} på ${path.split('?')[0]}`);
  return r.json();
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

// Hållplatser appen använder. ID:na är hämtade från Trafiklab 2026-10-13.
// Kan skrivas över med miljövariabler om något ändras.
export const STOPS = {
  homeMetro: { env: 'STOP_HAMMARBYHOJDEN', id: '740021695', mode: 'METRO', names: ['Hammarbyhöjden'] },
  cityMetro: { env: 'STOP_TCENTRALEN', id: '740020749', mode: 'METRO', names: ['T-Centralen'] },
  vasBus: { env: 'STOP_VASTERAS', id: '740000099', mode: 'BUS', names: ['Västerås Centralstation'] },
  workBus: { env: 'STOP_FINNSLATTEN', id: '740043363', mode: 'BUS', names: ['Finnslätten'] }
};

export async function lookupStop(def) {
  if (process.env[def.env]) return { id: process.env[def.env], name: def.names[0], source: 'inställning' };
  if (def.id) return { id: def.id, name: def.names[0], source: 'fast' };
  return cached('stop:' + def.names[0], 24 * HOUR, async () => {
    for (const name of def.names) {
      const data = await tlGet(`/stops/name/${encodeURIComponent(name)}`);
      const groups = (data.stop_groups || []).filter((g) => (g.transport_modes || []).includes(def.mode));
      const hit = groups.find((g) => norm(g.name) === norm(name)) ||
                  groups.find((g) => norm(g.name).startsWith(norm(name)));
      if (hit) return { id: String(hit.id), name: hit.name, type: hit.area_type, modes: hit.transport_modes, source: 'sökning' };
    }
    throw new Error(`Hittade ingen hållplats för ${def.names[0]}.`);
  });
}

async function board(kind, id, ms) {
  const t = msToParam(Math.floor(ms / (5 * MIN)) * 5 * MIN); // avrunda för bättre cache
  return cached(`${kind}:${id}:${t}`, 60 * 1000, () => tlGet(`/${kind}/${encodeURIComponent(id)}/${t}`));
}

const tripKey = (x) => (x && x.trip && x.trip.trip_id ? `${x.trip.trip_id}|${x.trip.start_date || ''}` : null);

// Hämtar avgångar från en hållplats och ankomster till en annan, och parar ihop samma tur.
export async function leg(from, to, startMs, hours) {
  const n = Math.min(3, Math.max(1, Math.ceil(hours)));
  const starts = Array.from({ length: n }, (_, i) => startMs + i * HOUR);
  const depBoards = await Promise.all(starts.map((s) => board('departures', from.id, s)));
  const arrBoards = await Promise.all([...starts, startMs + n * HOUR].map((s) => board('arrivals', to.id, s)));
  const arrBy = new Map();
  for (const a of arrBoards.flatMap((b) => b.arrivals || [])) {
    const k = tripKey(a);
    if (k) arrBy.set(k, a);
  }
  const out = [];
  const seen = new Set();
  for (const d of depBoards.flatMap((b) => b.departures || [])) {
    const k = tripKey(d);
    if (!k || seen.has(k)) continue;
    const a = arrBy.get(k);
    if (!a) continue;
    const dep = { sched: localToMs(d.scheduled), rt: localToMs(d.realtime || d.scheduled) };
    const arr = { sched: localToMs(a.scheduled), rt: localToMs(a.realtime || a.scheduled) };
    if (!(arr.rt > dep.rt)) continue;
    seen.add(k);
    const plat = d.realtime_platform || d.scheduled_platform;
    out.push({
      line: (d.route && (d.route.designation || d.route.name)) || '',
      mode: d.route && d.route.transport_mode,
      dest: (d.route && (d.route.direction || (d.route.destination && d.route.destination.name))) || '',
      canceled: d.canceled === true || d.canceled === 'true' || a.canceled === true || a.canceled === 'true',
      realtime: !!d.is_realtime,
      from: { ...dep, name: (d.stop && d.stop.name) || from.name, platform: plat ? plat.designation : null },
      to: { ...arr, name: (a.stop && a.stop.name) || to.name }
    });
  }
  return out.sort((x, y) => x.from.rt - y.from.rt);
}

// ---------- Trafikverket ----------
const TV_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const TV_FIELDS = ['AdvertisedTrainIdent', 'AdvertisedTimeAtLocation', 'EstimatedTimeAtLocation', 'TimeAtLocation',
  'TrackAtLocation', 'Canceled', 'ProductInformation', 'Operator', 'ToLocation', 'ScheduledDepartureDateTime', 'Deviation'];

const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function tvQuery(activity, sig, fromMs, toMs) {
  const include = TV_FIELDS.map((f) => `<INCLUDE>${f}</INCLUDE>`).join('');
  return `<QUERY objecttype="TrainAnnouncement" schemaversion="1.9" orderby="AdvertisedTimeAtLocation">` +
    `<FILTER><AND>` +
    `<EQ name="ActivityType" value="${activity}"/>` +
    `<EQ name="LocationSignature" value="${xmlEsc(sig)}"/>` +
    `<EQ name="Advertised" value="true"/>` +
    `<GT name="AdvertisedTimeAtLocation" value="${msToIso(fromMs)}"/>` +
    `<LT name="AdvertisedTimeAtLocation" value="${msToIso(toMs)}"/>` +
    `</AND></FILTER>${include}</QUERY>`;
}

const textOf = (v) => (v == null ? '' : typeof v === 'string' ? v : v.Description || v.LocationName || v.Code || '');
const tvTime = (a) => ({
  sched: Date.parse(a.AdvertisedTimeAtLocation),
  rt: Date.parse(a.TimeAtLocation || a.EstimatedTimeAtLocation || a.AdvertisedTimeAtLocation),
  track: a.TrackAtLocation || null
});

// Tåg som avgår från fromSig mellan fromMs och toMs och kommer fram till toSig ("Cst" = Stockholm C, "Vå" = Västerås C)
export async function trains(fromSig, toSig, fromMs, toMs, withRaw) {
  const key = process.env.TRAFIKVERKET_KEY;
  if (!key) throw new Error('TRAFIKVERKET_KEY saknas i Vercels inställningar.');
  const f = Math.floor(fromMs / MIN) * MIN;
  const t = Math.ceil(toMs / MIN) * MIN;
  return cached(`tv:${fromSig}:${toSig}:${f}:${t}:${withRaw ? 1 : 0}`, 30 * 1000, async () => {
    const body = `<REQUEST><LOGIN authenticationkey="${xmlEsc(key)}"/>` +
      tvQuery('Avgang', fromSig, f, t) +
      tvQuery('Ankomst', toSig, f, t + 3 * HOUR) +
      `</REQUEST>`;
    const r = await fetch(TV_URL, { method: 'POST', headers: { 'content-type': 'text/xml; charset=utf-8', accept: 'application/json' }, body });
    const json = await r.json().catch(() => null);
    const results = json && json.RESPONSE && json.RESPONSE.RESULT;
    const err = results && results.find((x) => x.ERROR);
    if (!r.ok || !results || err) {
      throw new Error(`Trafikverket svarade ${r.status}${err ? ': ' + err.ERROR.MESSAGE : ''}`);
    }
    const deps = results[0].TrainAnnouncement || [];
    const arrs = results[1].TrainAnnouncement || [];
    const k = (a) => `${a.AdvertisedTrainIdent}|${a.ScheduledDepartureDateTime || ''}`;
    const arrBy = new Map(arrs.map((a) => [k(a), a]));
    const out = [];
    for (const d of deps) {
      const a = arrBy.get(k(d));
      if (!a) continue;
      const from = tvTime(d);
      const to = tvTime(a);
      if (!(to.sched > from.sched)) continue;
      out.push({
        id: d.AdvertisedTrainIdent,
        product: (d.ProductInformation || []).map(textOf).filter(Boolean).join(', '),
        operator: d.Operator || '',
        canceled: !!(d.Canceled || a.Canceled),
        deviations: [...(d.Deviation || []), ...(a.Deviation || [])].map(textOf).filter(Boolean),
        from, to
      });
    }
    out.sort((a, b) => a.from.sched - b.from.sched);
    if (withRaw) return { list: out, rawDeps: deps.length, rawArrs: arrs.length, query: [msToIso(f), msToIso(t)] };
    return out;
  });
}

export const time = { MIN, HOUR };
