// Who "we" are in Slack, so our own posts can be recognised and excluded on
// read. Read-only: auth.test and bots.info never write anything.
export interface OwnBotIdentity {
  userIds: Set<string>;
  botIds: Set<string>;
  appIds: Set<string>;
}

export async function ownBotIdentity(token: string): Promise<OwnBotIdentity> {
  const id: OwnBotIdentity = { userIds: new Set(), botIds: new Set(), appIds: new Set() };
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data?.ok) {
      if (data.user_id) id.userIds.add(String(data.user_id));
      if (data.bot_id) {
        id.botIds.add(String(data.bot_id));
        const info = await fetch(`https://slack.com/api/bots.info?bot=${encodeURIComponent(data.bot_id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json()).catch(() => null);
        if (info?.ok && info.bot?.app_id) id.appIds.add(String(info.bot.app_id));
      }
    } else {
      console.error('ownBotIdentity: auth.test failed', data?.error);
    }
  } catch (e) {
    console.error('ownBotIdentity: auth.test threw', e);
  }
  return id;
}
