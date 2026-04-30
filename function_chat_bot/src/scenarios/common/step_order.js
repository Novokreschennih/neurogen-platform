const FUNNEL_STEPS = [
  "START", "Start_Choice", "AntiMLM",
  "Agent_1_Pain", "Agent_2_Offline", "Agent_3_Case_Anton",
  "Agent_2_Online", "Agent_Math",
  "Business_Offline_Pain", "Business_Offline_Solution", "Business_Offline_Case", "Business_Offline_Parachute",
  "Business_Online_Pain", "Business_Online_Solution", "Business_Online_Case",
  "Pre_Training_Logic",
  "WAIT_REG_ID", "WAIT_REG_TAIL", "WAIT_VERIFICATION", "WAIT_FUNNEL_EMAIL",
  "WAIT_SECRET_1", "WAIT_SECRET_2", "WAIT_SECRET_3",
  "WAIT_SH_ID_P", "WAIT_SH_TAIL_P", "WAIT_PARTNER_REG",
  "WAIT_BOT_TOKEN", "SETUP_BOT_START", "CONFIRM_BOT_DATA",
  "CHANNEL_SETUP_TG", "MULTI_CHANNEL_TG",
  "WAIT_TG_SETUP", "WAIT_EMAIL_INPUT",
  "Theory_Mod1", "Theory_Mod2", "Theory_Mod3", "Theory_Mod4", "Theory_Mod5", "Theory_Reward_Spoilers",
  "Training_Main", "Module_1_Strategy", "Module_2_Online", "Module_2_Reward_PromoKit",
  "Module_3_Offline", "Lesson_Final_Comparison",
  "ACADEMY_MENU",
  "Offer_Tripwire", "FAQ_PRO", "Tripwire_Features", "Tripwire_Math",
  "Delivery_1",
  "Training_Pro_Main", "Training_Pro_P1_1", "Training_Pro_P1_2", "Training_Pro_P1_3", "Training_Pro_P1_4", "Training_Pro_P1_5",
  "Training_Pro_P2_1", "Training_Pro_P2_2", "Training_Pro_P2_3", "Training_Pro_P2_4", "Training_Bot_Success",
  "Token_Success",
  "Rocket_Limits", "Shuttle_Offer", "UPGRADE_CONFIRMED"
];

export function getFunnelIndex(state) {
  const idx = FUNNEL_STEPS.indexOf(state);
  return idx >= 0 ? idx : -1;
}

const UNSUPPORTED_BY_CHANNEL = {
  telegram: [],
  vk: [
    "WAIT_BOT_TOKEN", "SETUP_BOT_START", "CONFIRM_BOT_DATA",
    "WAIT_SH_ID_P", "WAIT_SH_TAIL_P", "WAIT_PARTNER_REG",
    "CHANNEL_SETUP_TG", "MULTI_CHANNEL_TG",
  ],
  web: [
    "WAIT_BOT_TOKEN", "SETUP_BOT_START",
    "WAIT_SH_ID_P", "WAIT_SH_TAIL_P", "WAIT_PARTNER_REG",
  ],
  email: []
};

export function isStateSupported(state, channel) {
  const unsupported = UNSUPPORTED_BY_CHANNEL[channel] || [];
  return !unsupported.includes(state);
}

export function getNextSupportedState(currentState, channel) {
  if (isStateSupported(currentState, channel)) return currentState;
  const startIdx = FUNNEL_STEPS.indexOf(currentState);
  if (startIdx === -1) return "START";
  for (let i = startIdx + 1; i < FUNNEL_STEPS.length; i++) {
    if (isStateSupported(FUNNEL_STEPS[i], channel)) return FUNNEL_STEPS[i];
  }
  return "START";
}

export function adaptStateForChannel(user, channel) {
  if (!user.state) user.state = "START";
  if (!isStateSupported(user.state, channel)) {
    user.state = getNextSupportedState(user.state, channel);
  }
  return user;
}