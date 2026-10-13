# Pendelappen

Privat reseplanerare för pendlingen Hammarbyhöjden ↔ Finnslätten (ABB Robotics), Västerås.
Kombinerar T17, regionaltåget Stockholm C ↔ Västerås C och buss 4 med dina egna bytesmarginaler.

## Så hänger det ihop

```
index.html        Själva appen (lista, resedetalj, inställningar)
api/trips.js      Hämtar tåg, T-bana och buss och skickar till appen
api/debug.js      Felsökning: visar hållplatser som hittats och om nycklarna fungerar
api/_lib.js       Gemensam kod för anropen till Trafikverket och Trafiklab
```

Nycklarna ligger bara hos Vercel, aldrig i koden eller på GitHub.

## Inställningar hos Vercel (Environment Variables)

| Namn | Värde |
| --- | --- |
| `TRAFIKVERKET_KEY` | Din nyckel från data.trafikverket.se |
| `TRAFIKLAB_KEY` | Din Trafiklab-nyckel för Trafiklab Realtime APIs |
| `APP_PIN` | Valfri kod, t.ex. fyra siffror. Skrivs in i appens inställningar. |

Om appen väljer fel hållplats kan du låsa den med ett ID från `/api/debug`:
`STOP_HAMMARBYHOJDEN`, `STOP_TCENTRALEN`, `STOP_VASTERAS`, `STOP_FINNSLATTEN`.

## Ändra något

Redigera filen direkt på GitHub (pennan uppe till höger) och spara. Vercel lägger ut den nya versionen automatiskt efter ungefär en minut.

## Datakällor

- Trafikverkets öppna API (TrainAnnouncement): tåg, förseningar, spår.
- Trafiklab Realtime APIs: T-banan och bussen. Svaren sparas en minut för att hålla nere antalet anrop.
