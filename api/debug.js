import { lookupStop, trains, STOPS } from './_lib.js';

// GET /api/debug  (kräver ingen PIN) visar vilka hållplatser appen hittat och om nycklarna fungerar (aldrig nycklarna själva).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = {
    keys: {
      TRAFIKVERKET_KEY: !!process.env.TRAFIKVERKET_KEY,
      TRAFIKLAB_KEY: !!process.env.TRAFIKLAB_KEY,
      APP_PIN: !!process.env.APP_PIN
    },
    stops: {},
    trafikverket: null
  };
  for (const [name, def] of Object.entries(STOPS)) {
    try { out.stops[name] = await lookupStop(def); } catch (e) { out.stops[name] = { error: e.message }; }
  }
  try {
    const t = await trains('Cst', 'Vå');
    out.trafikverket = { ok: true, trainsStockholmToVasteras: t.length, first: t[0] || null };
  } catch (e) {
    out.trafikverket = { ok: false, error: e.message };
  }
  res.status(200).json(out);
}
