# Fix Meta OAuth callback domain

## What will change
- Move the Meta OAuth redirect to the public app URL at `https://hub.connectpaidmedia.com/meta/callback`, avoiding Meta's rejection of the backend hostname.
- Add a public callback page that securely forwards Meta's authorization response to the existing backend connection flow.
- Update the backend token exchange to use the same custom-domain redirect URI and preserve the selected RRM client.
- Verify the generated authorization URL and callback route.

## Meta configuration after the change
Add this exact value under **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**:

`https://hub.connectpaidmedia.com/meta/callback`

The existing `hub.connectpaidmedia.com` App Domain will then match the OAuth redirect.

## Technical details
- Keep Meta app credentials server-side.
- Validate callback inputs and return clear success/error states.
- Use matching redirect URIs during both authorization and token exchange, as required by Meta OAuth.
