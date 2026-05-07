export function buildStartPayload(user) {
  const partnerId = user.partner_id || user.sh_ref_tail || process.env.MY_PARTNER_ID || 'p_qdr';

  if (user.web_id) {
    return `${partnerId}__w${user.web_id}`;
  }

  if (user.email) {
    const emailEncoded = Buffer.from(user.email).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `${partnerId}__e${emailEncoded}`;
  }

  return partnerId;
}

export function parseStartPayload(payload) {
  if (!payload) return null;
  const parts = payload.split('__');
  const result = { partnerId: parts[0] || null };

  if (parts[1]) {
    const content = parts[1];
    if (content.startsWith('web_')) {
      result.webId = content;
    } else if (content.startsWith('w')) {
      result.webId = content.substring(1);
    } else if (content.startsWith('e')) {
      try {
        let enc = content.substring(1).replace(/-/g, '+').replace(/_/g, '/');
        enc += "=".repeat((4 - (enc.length % 4)) % 4);
        result.email = Buffer.from(enc, 'base64').toString('utf8');
      } catch (e) {}
    }
  }

  return result;
}