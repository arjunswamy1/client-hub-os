# homepromatch.net — click-ID and UTM capture requirement

**Audience:** whoever owns and can edit `homepromatch.net` (and `yourhomeservicespros.com`).
**Client:** River Road Media (RRM) — call tracking on Moja.
**Status:** REQUIREMENT, NOT APPLIED. Nothing in this document has been implemented. The
site is not in any Lovable workspace reachable from here (all four checked, 23 projects, no
match) and its scripts are not visible from the rendered page, so what the Moja snippet
currently sends is unknown.

---

## Why this exists

Moja has confirmed its outgoing webhook macro list. There is **no `gclid` macro and no
`fbclid` macro** — those values can only reach us as **custom tags**, populated from the
landing page (or an incoming webhook) and referenced in the Moja template.

`[UTM_SOURCE]` is the only UTM macro Moja confirmed.

The consequence, stated plainly: **until this is implemented, River Road has no click-level
key, so ad-level attribution is UNAVAILABLE — not low-coverage, unavailable.** Per-ad cut,
hold and scale verdicts can never run for this client, however much spend accumulates. No
amount of number mapping fixes it, because the number does not identify a creative.

Note that `gclid` and `fbclid` arrive by **auto-tagging**, independently of UTM tracking
templates. So a bare URL with no query string can still receive a click ID — which is why
this is worth doing regardless of what the ad accounts' tracking templates say.

## The requirement

1. **On first page load**, read these from the query string:
   `gclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid`, and every `utm_*` parameter
   (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`).

2. **Persist to `sessionStorage` immediately**, before anything else can navigate. Only
   overwrite a stored value when a **new non-empty** value arrives. A later internal
   navigation must never blank a click ID captured on entry — that single detail is the
   difference between attribution that survives a page click and attribution that does not.

3. **Attach all of them to every Moja number request**, not just the first one on the
   session. A number requested after the visitor has navigated must still carry the click ID.

4. **Send them as Moja custom tags** (there is no built-in macro), then reference those tags
   in the Moja webhook template so they arrive on the delivery.

## Exact tag names our webhook already reads

Send these names. The webhook reads each one from the top level of the payload **or** from
the custom-tag bag, so no code change is needed on our side once they start arriving:

| Tag name | Purpose |
| --- | --- |
| `gclid` | Google click ID (auto-tagging). Ad-level key. |
| `wbraid` | Google web-to-app click ID. Kept separate from `gclid` — the join key differs. |
| `gbraid` | Google app-to-web click ID. Kept separate. |
| `fbclid` | Meta click ID (auto-tagging). Ad-level key. |
| `msclkid` | Microsoft Ads click ID. |
| `utm_source` | Platform signal. Also arrives as `[UTM_SOURCE]`. |
| `utm_medium` | |
| `utm_campaign` | Campaign-level key. |
| `utm_term` | |
| `utm_content` | Usually the ad id or ad name — an ad-level key where it is populated. |

Any other tag is preserved too: unmapped fields are kept in a `custom_tags` bag rather than
dropped, so an extra name costs nothing but a missing one costs the whole attribution tier.

## Reference implementation sketch

Illustrative only — the site owner implements it in whatever the site already uses.

```js
(function captureClickKeys() {
  var KEYS = ['gclid','wbraid','gbraid','fbclid','msclkid',
              'utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
  var q = new URLSearchParams(window.location.search);
  KEYS.forEach(function (k) {
    var v = (q.get(k) || '').trim();
    // Only a NEW non-empty value may overwrite; never blank a captured key.
    if (v) sessionStorage.setItem('cpm_' + k, v);
  });
})();

function mojaTags() {                       // call this on EVERY number request
  var tags = {};
  ['gclid','wbraid','gbraid','fbclid','msclkid',
   'utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function (k) {
    var v = sessionStorage.getItem('cpm_' + k);
    if (v) tags[k] = v;
  });
  return tags;
}
```

## How to verify it worked

Place a test call after implementing, then open Media Brain → DAILY for River Road. The
**Last webhook receipt** panel shows the full field list and the whole custom-tag bag with
values. A click ID present there is the proof; anything else is an assumption.

## Related open items

- The three ad-side fields that would tell us whether UTMs are stamped at click time —
  Google `tracking_url_template` and `final_url_suffix`, Meta `creative{url_tags}` — are not
  captured by our syncs. Recorded as the `ad_side_utm_capture` UNKNOWN on River Road's
  economics record and on the sync backlog. "No UTMs in the final URL" is what we can see,
  not proof that none are stamped.
- Scoping risk: the same synced ad account holds Final Expense campaigns on
  `burialplansnow.tv` / `planesfunerariosahora.tv` at $0.00 spend. Historical, not River
  Road, but they would contaminate any window covering their active period.
