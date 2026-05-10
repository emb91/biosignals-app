/**
 * View-layer helpers for contact profile (location line, email list) on the leads UI.
 */

import type { ContactEmailCategory, ContactEmailRow } from './contact-emails';
import { emailsEqual } from './contact-emails';

const CATEGORY_ORDER: { cat: ContactEmailCategory; label: string }[] = [
  { cat: 'import', label: 'Imported' },
  { cat: 'enriched_work', label: 'Work' },
  { cat: 'enriched_personal', label: 'Personal' },
];

export function formatContactLocationDisplay(
  rawLocation: string | null | undefined,
  city: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const loc = (rawLocation || '').trim();
  const c = (city || '').trim();
  const co = (country || '').trim();
  const ni = (s: string) => s.toLowerCase();

  if (!loc && !c && !co) return null;

  let place = '';
  if (loc && c) {
    const li = ni(loc);
    const ci = ni(c);
    if (li.includes(ci) || ci.includes(li)) {
      place = loc.length >= c.length ? loc : c;
    } else {
      place = `${loc}, ${c}`;
    }
  } else {
    place = loc || c;
  }

  if (co) {
    const bi = ni(place);
    const coi = ni(co);
    if (place && !bi.includes(coi)) {
      return `${place}, ${co}`;
    }
    if (!place) return co;
  }

  return place || co || null;
}

export type ContactEmailDisplayRow = { label: string; email: string };

function sortByCreated(list: ContactEmailRow[]): ContactEmailRow[] {
  return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * @param mode full — primary + directory; enrichmentOnly — import + enriched only (edit form read-only box).
 */
export function buildContactEmailDisplayRows(
  primaryEmail: string | null | undefined,
  contactEmails: ContactEmailRow[] | null | undefined,
  mode: 'full' | 'enrichmentOnly' = 'full',
): ContactEmailDisplayRow[] {
  const rows: ContactEmailDisplayRow[] = [];
  const primary = (primaryEmail || '').trim();
  const list = sortByCreated(contactEmails ?? []);

  const alreadyListed = (email: string) => rows.some((r) => emailsEqual(r.email, email));

  if (mode === 'full' && primary) {
    rows.push({ label: 'Primary', email: primary });
  }

  for (const { cat, label } of CATEGORY_ORDER) {
    for (const r of list.filter((x) => x.category === cat)) {
      const em = r.email.trim();
      if (!em) continue;
      if (primary && emailsEqual(em, primary)) continue;
      if (alreadyListed(em)) continue;
      rows.push({ label, email: em });
    }
  }

  if (mode === 'full') {
    let userSlot = 2;
    for (const r of list.filter((x) => x.category === 'user')) {
      const em = r.email.trim();
      if (!em) continue;
      if (alreadyListed(em)) continue;
      rows.push({ label: `Email ${userSlot}`, email: em });
      userSlot += 1;
    }
  }

  return rows;
}
