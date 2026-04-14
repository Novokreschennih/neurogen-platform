/**
 * Channel Manager — Multi-Channel Orchestration
 * 
 * Manages channel configurations stored in user's session JSON.
 * No DB migration needed — everything lives in `session.channels` and `session.channel_states`.
 * 
 * Session structure:
 *   session.channels.telegram — Telegram channel config
 *   session.channels.vk       — VK channel config
 *   session.channels.web      — Website widget config
 *   session.channels.email    — Email channel config
 *   session.channel_states    — Per-channel funnel state
 *   session.email             — User's email address
 *   session.email_verified    — Email verification status
 */

/**
 * Available channels and their metadata
 */
export const CHANNELS = {
  telegram: {
    name: "Telegram",
    emoji: "📱",
    setupSteps: ["TG_REG_ID", "TG_REG_TAIL", "TG_BOT_TOKEN", "TG_CONFIRM"],
    requiresSh: true,   // Needs SetHubble registration
  },
  vk: {
    name: "VKontakte",
    emoji: "💬",
    setupSteps: ["VK_GROUP_ID", "VK_REG_ID", "VK_REG_TAIL", "VK_CONFIRM"],
    requiresSh: true,
  },
  web: {
    name: "Website Chat",
    emoji: "🌐",
    setupSteps: ["WEB_REG_ID", "WEB_REG_TAIL", "WEB_CONFIRM"],
    requiresSh: true,
  },
  email: {
    name: "Email Newsletter",
    emoji: "📧",
    setupSteps: ["EMAIL_VERIFY", "EMAIL_REG_ID", "EMAIL_REG_TAIL", "EMAIL_CONFIRM"],
    requiresSh: true,
  },
};

/**
 * Get channel config for a user
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key ("telegram", "vk", "web", "email")
 * @returns {object} Channel config (empty object if not set)
 */
export function getChannelConfig(user, channel) {
  return user.session?.channels?.[channel] || {};
}

/**
 * Set channel config for a user
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key
 * @param {object} config — Channel configuration to merge
 */
export function setChannelConfig(user, channel, config) {
  if (!user.session) user.session = { tags: [], dialog_history: [] };
  if (!user.session.channels) user.session.channels = {};
  if (!user.session.channels[channel]) user.session.channels[channel] = {};

  user.session.channels[channel] = {
    ...user.session.channels[channel],
    ...config,
  };
}

/**
 * Get funnel state for a specific channel
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key
 * @returns {string} Current funnel state for this channel
 */
export function getChannelState(user, channel) {
  return user.session?.channel_states?.[channel] || user.state || "START";
}

/**
 * Set funnel state for a specific channel
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key
 * @param {string} state — New funnel state
 */
export function setChannelState(user, channel, state) {
  if (!user.session) user.session = { tags: [], dialog_history: [] };
  if (!user.session.channel_states) user.session.channel_states = {};
  user.session.channel_states[channel] = state;
}

/**
 * Check if a channel is fully configured and enabled
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key
 * @returns {boolean}
 */
export function isChannelEnabled(user, channel) {
  const config = getChannelConfig(user, channel);
  return config.enabled === true && config.configured === true;
}

/**
 * Enable a channel (mark as enabled but not yet configured)
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key
 */
export function enableChannel(user, channel) {
  setChannelConfig(user, channel, { enabled: true });
}

/**
 * Mark a channel as fully configured
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key
 */
export function configureChannel(user, channel) {
  setChannelConfig(user, channel, {
    configured: true,
    configured_at: Date.now(),
  });
}

/**
 * Get list of enabled channels for a user
 * @param {object} user — User object from YDB
 * @returns {string[]} Array of enabled channel keys
 */
export function getEnabledChannels(user) {
  const channels = user.session?.channels || {};
  return Object.keys(channels).filter((ch) => channels[ch].enabled);
}

/**
 * Get list of fully configured channels for a user
 * @param {object} user — User object from YDB
 * @returns {string[]} Array of configured channel keys
 */
export function getConfiguredChannels(user) {
  const channels = user.session?.channels || {};
  return Object.keys(channels).filter((ch) => channels[ch].enabled && channels[ch].configured);
}

/**
 * Get the best channel to use for sending messages to a user
 * Priority: Telegram > VK > Email > Web
 * @param {object} user — User object from YDB
 * @returns {string|null} Best channel key, or null if none configured
 */
export function getPrimaryChannel(user) {
  const priority = ["telegram", "vk", "email", "web"];
  for (const ch of priority) {
    if (isChannelEnabled(user, ch)) return ch;
  }
  return null;
}

/**
 * Get SetHubble credentials for a specific channel
 * Returns credentials from channel config, falling back to root-level if channel not yet configured
 * @param {object} user — User object from YDB
 * @param {string} channel — Channel key
 * @returns {object} { sh_user_id, sh_ref_tail }
 */
export function getShCredentials(user, channel) {
  const channelConfig = getChannelConfig(user, channel);
  return {
    sh_user_id: channelConfig.sh_user_id || user.sh_user_id || "",
    sh_ref_tail: channelConfig.sh_ref_tail || user.sh_ref_tail || "",
  };
}

/**
 * Get users by channel for CRON processing
 * @param {object} ydb — YDB helper instance
 * @param {string} channel — Channel key
 * @param {object} options
 * @param {number} [options.hoursAgo=1] — Inactive for X hours
 * @param {number} [options.limit=50] — Max users
 * @param {number} [options.offset=0] — Pagination offset
 * @param {string} [options.requiredState] — Filter by channel state
 * @returns {Promise<Array>} Array of users with the specified channel
 */
export async function getUsersByChannel(
  ydb,
  channel,
  { hoursAgo = 1, limit = 50, offset = 0, requiredState } = {},
) {
  const staleUsers = await ydb.getStaleUsers(hoursAgo, limit, offset);

  return staleUsers.filter((user) => {
    // Must have the channel enabled
    if (!isChannelEnabled(user, channel)) return false;

    // If requiredState specified, check channel state
    if (requiredState) {
      const chState = getChannelState(user, channel);
      if (chState !== requiredState) return false;
    }

    return true;
  });
}

/**
 * Get user identifier for a specific channel
 * v6.0: ID каналов теперь в отдельных колонках (tg_id, vk_id, web_id)
 * @param {object} user — User object from YDB (v6.0 schema)
 * @param {string} channel — Channel key
 * @returns {string|null} Channel-specific user ID, or null
 */
export function getChannelUserId(user, channel) {
  switch (channel) {
    case "telegram":
      return user.tg_id ? String(user.tg_id) : null;
    case "vk":
      return user.vk_id ? String(user.vk_id) : null;
    case "web":
      return user.web_id || null;
    case "email":
      return user.email || null;
    default:
      return null;
  }
}

/**
 * Build channel summary for CRM display
 * @param {object} user — User object from YDB
 * @returns {Array<{ channel: string, enabled: boolean, configured: boolean, state: string }>}
 */
export function getChannelSummary(user) {
  const result = [];
  for (const [key, meta] of Object.entries(CHANNELS)) {
    const config = getChannelConfig(user, key);
    result.push({
      channel: key,
      name: meta.name,
      emoji: meta.emoji,
      enabled: config.enabled === true,
      configured: config.configured === true,
      state: getChannelState(user, key),
    });
  }
  return result;
}

/**
 * v6.0: Auto-detect and enable channels from DB columns
 * Если у пользователя заполнены tg_id/vk_id/web_id/email —
 * соответствующие каналы помечаются как configured автоматически
 * @param {object} user — User object from YDB (v6.0 schema)
 */
export function autoDetectChannels(user) {
  if (!user.session) user.session = { tags: [], dialog_history: [] };
  if (!user.session.channels) user.session.channels = {};
  if (!user.session.channel_states) user.session.channel_states = {};

  // Telegram — если есть tg_id
  if (user.tg_id && !user.session.channels.telegram?.configured) {
    user.session.channels.telegram = {
      ...user.session.channels.telegram,
      enabled: true,
      configured: true,
      configured_at: Date.now(),
    };
    user.session.channel_states.telegram = user.session.channel_states.telegram || "START";
  }

  // VK — если есть vk_id
  if (user.vk_id && !user.session.channels.vk?.configured) {
    user.session.channels.vk = {
      ...user.session.channels.vk,
      enabled: true,
      configured: true,
      configured_at: Date.now(),
      group_id: String(user.vk_id),
    };
    user.session.channel_states.vk = user.session.channel_states.vk || "START";
  }

  // Web — если есть web_id
  if (user.web_id && !user.session.channels.web?.configured) {
    user.session.channels.web = {
      ...user.session.channels.web,
      enabled: true,
      configured: true,
      configured_at: Date.now(),
      session_id: user.web_id,
    };
    user.session.channel_states.web = user.session.channel_states.web || "START";
  }

  // Email — если есть email
  if (user.email && !user.session.channels.email?.configured) {
    user.session.channels.email = {
      ...user.session.channels.email,
      enabled: true,
      configured: true,
      configured_at: Date.now(),
      subscribed: true,
    };
    user.session.channel_states.email = user.session.channel_states.email || "START";
  }
}

/**
 * v6.0: Получить список каналов, доступных для настройки
 * Исключает уже настроенные каналы
 * @param {object} user — User object from YDB
 * @returns {string[]} Array of channel keys that need setup
 */
export function getAvailableChannels(user) {
  return Object.keys(CHANNELS).filter((ch) => !isChannelEnabled(user, ch));
}

/**
 * v6.0: Получить рекомендуемый следующий канал для предложения
 * Приоритет: Telegram > VK > Email > Web
 * @param {object} user — User object from YDB
 * @returns {string|null} Channel key to suggest, or null if all configured
 */
export function getNextChannelToSuggest(user) {
  const priority = ["telegram", "vk", "email", "web"];
  for (const ch of priority) {
    if (!isChannelEnabled(user, ch)) return ch;
  }
  return null;
}

export default {
  CHANNELS,
  getChannelConfig,
  setChannelConfig,
  getChannelState,
  setChannelState,
  isChannelEnabled,
  enableChannel,
  configureChannel,
  getEnabledChannels,
  getConfiguredChannels,
  getPrimaryChannel,
  getShCredentials,
  getUsersByChannel,
  getChannelUserId,
  getChannelSummary,
  autoDetectChannels,
  getAvailableChannels,
  getNextChannelToSuggest,
};
