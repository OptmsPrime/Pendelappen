import { lookupStop, trains, STOPS, time } from './_lib.js';

const { MIN, HOUR } = time;

// GET /api/debug  (kräver ingen PIN) visar vilka hållplatser appen använder och om nycklarna fungerar (aldrig nycklarna själva).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const now = Date.now();
  const out = {
    keys: {
      TRAFIKVERKET_KEY: !!process.env.TRAFIKVERKET_KEY,
      TRAFIKLAB_KEY: !!process.env.TRAFIKLAB_KEY,
      APP_PIN: !!process.env.APP_PIN
    },
    stops: {},
    trafikverket: {}
  };
  for (const [name, def] of Object.entries(STOPS)) {
    try { out.stops[name] = await lookupStop(def); } catch (e) { out.stops[name] = { error: e.message }; }
  }
  const hours = Math.min(24, Number(req.query.hours) || 6);
  for (const [label, from, to] of [['tillJobbet', 'Cst', 'Vå'], ['hem', 'Vå', 'Cst']]) {
    try {
      const r = await trains(from, to, now - 30 * MIN, now + hours * HOUR, true);
      out.trafikverket[label] = {
        ok: true, query: r.query, avgangar: r.rawDeps, ankomster: r.rawArrs, matchade: r.list.length,
        tag: r.list.map((t) => `${t.id} ${t.product} ${new Date(t.from.sched).toISOString()} spår ${t.from.track || '?'}`)
      };
    } catch (e) {
      out.trafikverket[label] = { ok: false, error: e.message };
    }
  }
  res.status(200).json(out);
}
