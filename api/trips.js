import { checkPin, lookupStop, leg, trains, STOPS, time } from './_lib.js';

const { MIN, HOUR } = time;

// GET /api/trips?dir=work  eller  /api/trips?dir=home
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkPin(req, res)) return;
  const dir = req.query.dir === 'home' ? 'home' : 'work';
  const now = Date.now();
  const warnings = [];

  try {
    const all = await trains(dir === 'work' ? 'Cst' : 'Vå', dir === 'work' ? 'Vå' : 'Cst');
    const list = all.filter((t) => t.from.rt > now - 2 * MIN).slice(0, 4);

    let metro = [];
    let bus = [];
    if (list.length) {
      const lastDep = Math.max(...list.map((t) => t.from.rt));
      const firstArr = Math.min(...list.map((t) => t.to.rt));
      const lastArr = Math.max(...list.map((t) => t.to.rt));
      const start = now - 10 * MIN;

      const [homeMetro, cityMetro, vasBus, workBus] = await Promise.all([
        lookupStop(STOPS.homeMetro), lookupStop(STOPS.cityMetro), lookupStop(STOPS.vasBus), lookupStop(STOPS.workBus)
      ]);

      const jobs = dir === 'work'
        ? [
            leg(homeMetro, cityMetro, start, (lastDep - start) / HOUR),
            leg(vasBus, workBus, firstArr, (lastArr + 45 * MIN - firstArr) / HOUR)
          ]
        : [
            leg(cityMetro, homeMetro, firstArr, (lastArr + 30 * MIN - firstArr) / HOUR),
            leg(workBus, vasBus, start, (lastDep - start) / HOUR)
          ];
      const [m, b] = await Promise.allSettled(jobs);
      if (m.status === 'fulfilled') metro = m.value; else warnings.push('T-banan: ' + m.reason.message);
      if (b.status === 'fulfilled') bus = b.value; else warnings.push('Bussen: ' + b.reason.message);
    }

    res.status(200).json({ dir, generatedAt: now, trains: list, metro, bus, warnings });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Något gick fel när data hämtades.' });
  }
}
