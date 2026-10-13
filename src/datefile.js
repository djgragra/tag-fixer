// A date and a time for the origination fields, from the modification time of the file or from its name
// ("2026-10-13_0830_morning.wav", "20261013-083000", "13.10.2026 08.30"). Pure.
const pad2 = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const validDate = (y, m, d) => y >= 1900 && y <= 2199 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
const validTime = (h, mi, s) => h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;

export function fromMtime(ms) {
  const d = new Date(ms);
  return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
}

const TIME_AFTER = /^[ _\-T.]?(\d{2})[-_.:h]?(\d{2})(?:[-_.:m]?(\d{2}))?(?!\d)/;
// -> { y, mo, d, h?, mi?, s? } or null. The first valid date in the name wins; a time right after it is read too.
export function fromName(name) {
  const base = String(name).replace(/\.[^.]*$/, '');
  const tries = [
    { re: /(?<!\d)((?:19|20|21)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/g, pick: (m) => [+m[1], +m[2], +m[3]] },
    { re: /(?<!\d)(\d{2})[-_.](\d{2})[-_.]((?:19|20|21)\d{2})(?!\d)/g, pick: (m) => [+m[3], +m[2], +m[1]] }
  ];
  for (const { re, pick } of tries) {
    for (const m of base.matchAll(re)) {
      const [y, mo, d] = pick(m);
      if (!validDate(y, mo, d)) continue;
      const out = { y, mo, d };
      const t = TIME_AFTER.exec(base.slice(m.index + m[0].length));
      if (t) {
        const [h, mi, s] = [+t[1], +t[2], t[3] === undefined ? 0 : +t[3]];
        if (validTime(h, mi, s)) Object.assign(out, { h, mi, s });
      }
      return out;
    }
  }
  return null;
}

// kind 'bext': 2026-10-13 and 08-30-00 (EBU Tech 3285) · 'cart': 2026/10/13 and 08:30:00 (AES46)
export function format(p, kind = 'bext') {
  const ds = kind === 'cart' ? '/' : '-', ts = kind === 'cart' ? ':' : '-';
  return { date: `${p.y}${ds}${pad2(p.mo)}${ds}${pad2(p.d)}`, time: p.h === undefined ? null : `${pad2(p.h)}${ts}${pad2(p.mi)}${ts}${pad2(p.s)}` };
}
