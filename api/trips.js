import { checkPin, lookupStop, leg, trains, STOPS, time } from './_lib.js';

const { MIN, HOUR } = time;

// GET /api/trips?dir=work|home              Åk nu: tåg de närmaste fyra timmarna
// GET /api/trips?dir=work|home&arriveBy=ms  Framme senast: tåg som hinner fram till den tiden
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkPin(req, res)) return;
  const dir = req.query.dir === 'home' ? 'home' : 'work';
  const now = Date.now();
  const arriveBy = Number(req.query.arriveBy) > now ? Number(req.query.arriveBy) : null;
  const warnings = [];

  try {
    const fromSig = dir === 'work' ? 'Cst' : 'Vå';
    const toSig = dir === 'work' ? 'Vå' : 'Cst';
    let list;
    if (arriveBy) {
      // Tåget behöver vara framme minst 10 min före måltiden för att sista steget ska hinnas.
      const all = await trains(fromSig, toSig, arriveBy - 4 * HOUR, arriveBy - 45 * MIN);
      list = all.filter((t) => t.to.rt <= arriveBy - 10 * MIN && t.from.rt > now - 2 * MIN).slice(-4);
    } else {
      const all = await trains(fromSig, toSig, now - 30 * MIN, now + 4 * HOUR);
      list = all.filter((t) => t.from.rt > now - 2 * MIN).slice(0, 4);
    }

    let metro = [];
    let bus = [];
    if (list.length) {
      const firstDep = Math.min(...list.map((t) => t.from.rt));
      const lastDep = Math.max(...list.map((t) => t.from.rt));
      const firstArr = Math.min(...list.map((t) => t.to.rt));
      const lastArr = Math.max(...list.map((t) => t.to.rt));
      // Första steget (T-banan eller bussen till tåget) söks från knappt en timme före första tåget.
      const firstLegStart = Math.max(now - 10 * MIN, firstDep - 50 * MIN);

      const [homeMetro, cityMetro, vasBus, workBus] = await Promise.all([
        lookupStop(STOPS.homeMetro), lookupStop(STOPS.cityMetro), lookupStop(STOPS.vasBus), lookupStop(STOPS.workBus)
      ]);

      const jobs = dir === 'work'
        ? [
            leg(homeMetro, cityMetro, firstLegStart, (lastDep - firstLegStart) / HOUR),
            leg(vasBus, workBus, firstArr, (lastArr + 45 * MIN - firstArr) / HOUR)
          ]
        : [
            leg(cityMetro, homeMetro, firstArr, (lastArr + 30 * MIN - firstArr) / HOUR),
            leg(workBus, vasBus, firstLegStart, (lastDep - firstLegStart) / HOUR)
          ];
      const [m, b] = await Promise.allSettled(jobs);
      if (m.status === 'fulfilled') metro = m.value; else warnings.push('T-banan: ' + m.reason.message);
      if (b.status === 'fulfilled') bus = b.value; else warnings.push('Bussen: ' + b.reason.message);
    }

    res.status(200).json({ dir, arriveBy, generatedAt: now, trains: list, metro, bus, warnings });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Något gick fel när data hämtades.' });
  }
}
