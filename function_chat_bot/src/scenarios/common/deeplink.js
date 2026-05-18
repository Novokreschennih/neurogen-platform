export function buildStartPayload(user) {
  const partnerId = user.sh_ref_tail || "p_qdr";
  const afid = user.partner_afid || process.env.MY_SH_USER_ID || "1123";

  let base = partnerId;

  if (user.web_id) {
    base = `${partnerId}__w${user.web_id}`;
  } else if (user.email) {
    const emailEncoded = Buffer.from(user.email).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    base = `${partnerId}__e${emailEncoded}`;
  }

  return `${base}|a${afid}`;
}

export function parseStartPayload(payload) {
  if (!payload) return null;

  let afid = null;
  let mainPart = payload;

  if (payload.includes("|a")) {
    const pipeIdx = payload.indexOf("|a");
    afid = payload.substring(pipeIdx + 2);
    mainPart = payload.substring(0, pipeIdx);
  }

  const parts = mainPart.includes("__") ? mainPart.split("__") : [mainPart];
  const result = { partnerId: parts[0] || null, partnerAfid: afid };

  if (parts[1]) {
    const content = parts[1];
    if (content.startsWith("web_")) {
      result.webId = content;
    } else if (content.startsWith("w")) {
      result.webId = content.substring(1);
    } else if (content.startsWith("e")) {
      try {
        let enc = content.substring(1).replace(/-/g, '+').replace(/_/g, '/');
        enc += "=".repeat((4 - (enc.length % 4)) % 4);
        result.email = Buffer.from(enc, 'base64').toString('utf8');
      } catch (e) {}
    }
  }

  return result;
}