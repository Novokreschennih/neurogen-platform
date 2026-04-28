import * as ydb from "../../ydb_helper.js";
import { getFunnelIndex } from "../scenarios/common/step_order.js";

function mergeUserData(target, source) {
  if (!target.session) target.session = {};
  if (!source.session) source.session = {};

  const combinedTags = [
    ...new Set([
      ...(target.session.tags || []),
      ...(source.session.tags || []),
    ]),
  ];
  target.session.tags = combinedTags;

  if (source.session.mod1_done) target.session.mod1_done = true;
  if (source.session.mod2_done) target.session.mod2_done = true;
  if (source.session.mod3_done) target.session.mod3_done = true;
  if (source.session.theory_complete) target.session.theory_complete = true;

  target.session.xp = (target.session.xp || 0) + (source.session.xp || 0);

  if (source.bought_tripwire) target.bought_tripwire = true;
  target.purchases = [
    ...new Set([...(target.purchases || []), ...(source.purchases || [])]),
  ];

  const hist1 = target.session.dialog_history || [];
  const hist2 = source.session.dialog_history || [];
  target.session.dialog_history = [...hist1, ...hist2].slice(-20);

  if (!target.session.channels) target.session.channels = {};
  if (source.session.channels) {
    for (const [ch, cfg] of Object.entries(source.session.channels)) {
      if (
        !target.session.channels[ch] ||
        !target.session.channels[ch].configured
      ) {
        target.session.channels[ch] = { ...cfg };
      }
    }
  }

  if (!target.email && source.email) target.email = source.email;
  if (source.ai_active_until > (target.ai_active_until || 0)) {
    target.ai_active_until = source.ai_active_until;
  }
  if (!target.first_name && source.first_name)
    target.first_name = source.first_name;
}

export async function resolveUser(channel, ids) {
  const searchCrits = [];
  if (ids.tg_id) searchCrits.push({ tg_id: ids.tg_id });
  if (ids.vk_id) searchCrits.push({ vk_id: ids.vk_id });
  if (ids.web_id) searchCrits.push({ web_id: ids.web_id });
  if (ids.email) searchCrits.push({ email: ids.email });

  const found = [];
  for (const crit of searchCrits) {
    const u = await ydb.findUser(crit);
    if (u && !found.some((x) => x.id === u.id)) found.push(u);
  }

  let main;
  if (found.length === 0) {
    let existing = null;
    if (ids.email) {
      existing = await ydb.findUser({ email: ids.email });
    }
    if (!existing && ids.web_id) {
      existing = await ydb.findUser({ web_id: ids.web_id });
    }

    if (existing) {
      if (ids.tg_id && !existing.tg_id) existing.tg_id = ids.tg_id;
      if (ids.vk_id && !existing.vk_id) existing.vk_id = ids.vk_id;
      if (ids.web_id && !existing.web_id) existing.web_id = ids.web_id;
      if (!existing.session) existing.session = {};
      if (!existing.session.channels) existing.session.channels = {};
      existing.session.channels[channel] = {
        ...(existing.session.channels[channel] || {}),
        enabled: true,
        configured: true,
      };
      await ydb.saveUser(existing);
      return existing;
    }

    main = {
      tg_id: ids.tg_id || 0,
      vk_id: ids.vk_id || 0,
      web_id: ids.web_id || "",
      email: ids.email || "",
      partner_id: ids.partner_id || process.env.MY_PARTNER_ID || "p_qdr",
      state: "START",
      bought_tripwire: false,
      purchases: [],
      session: {
        tags: [],
        dialog_history: [],
        channels: {},
        xp: 0,
      },
      last_seen: Date.now(),
      first_name: ids.first_name || "Пользователь",
    };
    main.session.channels[channel] = { enabled: true, configured: true };
    const res = await ydb.saveUser(main);
    main.id = res.id;
    return main;
  }

  main = found.reduce((best, cur) => {
    const bestIdx = getFunnelIndex(best.state);
    const curIdx = getFunnelIndex(cur.state);
    if (curIdx > bestIdx) return cur;
    if (curIdx === bestIdx && (cur.last_seen || 0) > (best.last_seen || 0))
      return cur;
    return best;
  });

  for (const u of found) {
    if (u.id !== main.id) {
      mergeUserData(main, u);
      await ydb.mergeUsers(main, u.id, "omni_resolve");
    }
  }

  if (ids.tg_id && !main.tg_id) main.tg_id = ids.tg_id;
  if (ids.vk_id && !main.vk_id) main.vk_id = ids.vk_id;
  if (ids.web_id && !main.web_id) main.web_id = ids.web_id;
  if (ids.email && !main.email) main.email = ids.email;
  if (ids.partner_id && !main.partner_id) main.partner_id = ids.partner_id;
  if (ids.first_name && !main.first_name) main.first_name = ids.first_name;

  if (!main.session) main.session = {};
  if (!main.session.channels) main.session.channels = {};
  main.session.channels[channel] = {
    ...(main.session.channels[channel] || {}),
    enabled: true,
    configured: true,
  };

  // Небольшая пауза, чтобы YDB Serverless успела обработать предыдущие запросы
  await new Promise((res) => setTimeout(res, 50));

  await ydb.saveUser(main);
  return main;
}
