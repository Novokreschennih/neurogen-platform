/**
 * Метаданные шагов воронки (ОБЩИЕ для всех платформ)
 * Сгенерировано автоматически: scripts/convert_scenario.js
 * Здесь: image, tag
 *
 * Кнопки — в platform-specific файлах (telegram/buttons.js, vk/buttons.js)
 */

import { STORAGE_BUCKET_URL } from "./constants.js";

export const stepMeta = {

  // === START ===
  START: {image: `${STORAGE_BUCKET_URL}/main_intro.jpg`},

  // === Start_Choice ===
  Start_Choice: {image: `${STORAGE_BUCKET_URL}/roles_diverge.jpg`},

  // === AntiMLM ===
  AntiMLM: {tag: "interest_scam"},

  // === Agent_1_Pain ===
  Agent_1_Pain: {image: `${STORAGE_BUCKET_URL}/agent_pain.jpg`, tag: "segment_agent"},

  // === Agent_3_Case_Anton ===
  Agent_3_Case_Anton: {image: `${STORAGE_BUCKET_URL}/case_anton.jpg`, tag: "case_anton"},

  // === Agent_2_Online ===
  Agent_2_Online: {image: `${STORAGE_BUCKET_URL}/online_whale.jpg`},

  // === Agent_Math ===
  Agent_Math: {image: `${STORAGE_BUCKET_URL}/network_math.jpg`, tag: "agent_math"},

  // === Business_Offline_Pain ===
  Business_Offline_Pain: {image: `${STORAGE_BUCKET_URL}/offline_pain.jpg`, tag: "segment_offline"},

  // === Business_Offline_Solution ===
  Business_Offline_Solution: {tag: "offline_solution"},

  // === Business_Offline_Case ===
  Business_Offline_Case: {image: `${STORAGE_BUCKET_URL}/case_elena.jpg`, tag: "case_elena"},

  // === Business_Offline_Parachute ===
  Business_Offline_Parachute: {tag: "offline_parachute"},

  // === Business_Online_Pain ===
  Business_Online_Pain: {image: `${STORAGE_BUCKET_URL}/online_pain.jpg`, tag: "segment_online"},

  // === Business_Online_Solution ===
  Business_Online_Solution: {tag: "online_solution"},

  // === Business_Online_Case ===
  Business_Online_Case: {image: `${STORAGE_BUCKET_URL}/case_max.jpg`, tag: "case_max"},

  // === Pre_Training_Logic ===
  Pre_Training_Logic: {tag: "gate_registration"},

  // === Theory_Mod1 ===
  Theory_Mod1: {image: `${STORAGE_BUCKET_URL}/academy_theory.jpg`, tag: "theory_course"},

  // === Theory_Mod2 ===
  Theory_Mod2: {tag: "theory_course"},

  // === Theory_Mod3 ===
  Theory_Mod3: {tag: "theory_course"},

  // === Theory_Mod4 ===
  Theory_Mod4: {tag: "theory_course"},

  // === Theory_Mod5 ===
  Theory_Mod5: {tag: "theory_course"},

  // === Theory_Reward_Spoilers ===
  Theory_Reward_Spoilers: {tag: "theory_spoilers"},

  // === Training_Main ===
  Training_Main: {image: `${STORAGE_BUCKET_URL}/copy_system.jpg`, tag: "start_training"},

  // === Module_1_Strategy ===
  Module_1_Strategy: {image: `${STORAGE_BUCKET_URL}/mod1_strategy.jpg`},

  // === Module_2_Online ===
  Module_2_Online: {image: `${STORAGE_BUCKET_URL}/mod2_online.jpg`, tag: "module_2"},

  // === Module_2_Reward_PromoKit ===
  Module_2_Reward_PromoKit: {tag: "module_2_reward"},

  // === Module_3_Offline ===
  Module_3_Offline: {tag: "module_3_start"},

  // === LOCKED_B2B_INFO ===
  LOCKED_B2B_INFO: {tag: "locked_b2b"},

  // === Lesson_Final_Comparison ===
  Lesson_Final_Comparison: {image: `${STORAGE_BUCKET_URL}/final_compare.jpg`, tag: "theory_course"},

  // === Offer_Tripwire ===
  Offer_Tripwire: {image: `${STORAGE_BUCKET_URL}/offer_pro.jpg`, tag: "offer_pro"},

  // === ACADEMY_MENU ===
  ACADEMY_MENU: {tag: "academy_menu"},

  // === FAQ_PRO ===
  FAQ_PRO: {tag: "faq_pro"},

  // === Tripwire_Features ===
  Tripwire_Features: {tag: "offer_tripwire_features"},

  // === Tripwire_Math ===
  Tripwire_Math: {tag: "offer_tripwire_price"},

  // === SYSTEM_SETUP ===
  SYSTEM_SETUP: {tag: "system_setup"},

  // === TOOLS_MENU ===
  TOOLS_MENU: {tag: "tools_menu"},

  // === LOCKED_CRM ===
  LOCKED_CRM: {tag: "locked_crm"},

  // === LOCKED_PROMO ===
  LOCKED_PROMO: {tag: "locked_promo"},

  // === LOCKED_KNOWLEDGE ===
  LOCKED_KNOWLEDGE: {tag: "locked_knowledge"},

  // === LOCKED_AI_APPS ===
  LOCKED_AI_APPS: {tag: "locked_ai"},

  // === MY_AI_BOT ===
  MY_AI_BOT: {tag: "my_ai_bot_status"},

  // === Delivery_1 ===
  Delivery_1: {tag: "delivery_materials"},

  // === Training_Pro_Main ===
  Training_Pro_Main: {image: `${STORAGE_BUCKET_URL}/pro_center.jpg`, tag: "start_training_pro"},

  // === Training_Pro_P1_1 ===
  Training_Pro_P1_1: {tag: "pro_p1_1"},

  // === Training_Pro_P1_2 ===
  Training_Pro_P1_2: {tag: "pro_p1_2"},

  // === Training_Pro_P1_3 ===
  Training_Pro_P1_3: {tag: "pro_p1_3"},

  // === Training_Pro_P1_4 ===
  Training_Pro_P1_4: {tag: "pro_p1_4"},

  // === Training_Pro_P1_5 ===
  Training_Pro_P1_5: {tag: "pro_p1_5"},

  // === Training_Pro_P2_1 ===
  Training_Pro_P2_1: {tag: "pro_p2_1"},

  // === Training_Pro_P2_2 ===
  Training_Pro_P2_2: {tag: "pro_p2_2"},

  // === Training_Pro_P2_3 ===
  Training_Pro_P2_3: {tag: "pro_p2_3"},

  // === Training_Pro_P2_4 ===
  Training_Pro_P2_4: {tag: "pro_p2_4"},

  // === Training_Bot_Success ===
  Training_Bot_Success: {tag: "bot_deployed_success"},

  // === Token_Success ===
  Token_Success: {image: `${STORAGE_BUCKET_URL}/activation.jpg`, tag: "token_success"},

  // === UPGRADE_CONFIRMED ===
  UPGRADE_CONFIRMED: {tag: "upgrade_confirmed"},

  // === SUPPORT_ASK ===
  SUPPORT_ASK: {tag: "support_ask"},

  // === FollowUp_Tripwire_1 ===
  FollowUp_Tripwire_1: {image: `${STORAGE_BUCKET_URL}/dozhim_1.jpg`, tag: "followup_tripwire"},

  // === FollowUp_Tripwire_2 ===
  FollowUp_Tripwire_2: {tag: "followup_tripwire"},

  // === FollowUp_Tripwire_3 ===
  FollowUp_Tripwire_3: {image: `${STORAGE_BUCKET_URL}/dozhim_3.jpg`, tag: "followup_tripwire"},

  // === FollowUp_Tripwire_4 ===
  FollowUp_Tripwire_4: {tag: "followup_tripwire"},

  // === FollowUp_Tripwire_5 ===
  FollowUp_Tripwire_5: {tag: "followup_tripwire"},

  // === FollowUp_Tripwire_6 ===
  FollowUp_Tripwire_6: {tag: "followup_tripwire"},

  // === FollowUp_Tripwire_7 ===
  FollowUp_Tripwire_7: {tag: "followup_tripwire"},

  // === FollowUp_Tripwire_8 ===
  FollowUp_Tripwire_8: {tag: "followup_tripwire"},

  // === FollowUp_Tripwire_9 ===
  FollowUp_Tripwire_9: {tag: "followup_tripwire"},

  // === FollowUp_Tripwire_10 ===
  FollowUp_Tripwire_10: {tag: "followup_tripwire"},

  // === FollowUp_Plan_1 ===
  FollowUp_Plan_1: {tag: "followup_plan"},

  // === FollowUp_Plan_2 ===
  FollowUp_Plan_2: {tag: "followup_plan"},

  // === FollowUp_Plan_3 ===
  FollowUp_Plan_3: {tag: "followup_plan"},

  // === FollowUp_Plan_4 ===
  FollowUp_Plan_4: {tag: "followup_plan"},

  // === FollowUp_Plan_5 ===
  FollowUp_Plan_5: {tag: "followup_plan"},

  // === FollowUp_Plan_6 ===
  FollowUp_Plan_6: {tag: "followup_plan"},

  // === FollowUp_Plan_7 ===
  FollowUp_Plan_7: {tag: "followup_plan"},

  // === FollowUp_Plan_8 ===
  FollowUp_Plan_8: {tag: "followup_plan"},

  // === FollowUp_Plan_9 ===
  FollowUp_Plan_9: {tag: "followup_plan"},

  // === FollowUp_Plan_10 ===
  FollowUp_Plan_10: {tag: "followup_plan"},

  // === REMINDER_1H ===
  REMINDER_1H: {tag: "remind_1h"},

  // === REMINDER_3H ===
  REMINDER_3H: {tag: "remind_3h"},

  // === REMINDER_24H ===
  REMINDER_24H: {tag: "remind_24h"},

  // === REMINDER_48H ===
  REMINDER_48H: {tag: "remind_48h"},

  // === RESUME_GATE ===
  RESUME_GATE: {tag: "resume_gate"},

  // === REMINDER_1H_RESUME ===
  REMINDER_1H_RESUME: {tag: "remind_resume"},

  // === REMINDER_3H_RESUME ===
  REMINDER_3H_RESUME: {tag: "remind_resume"},

  // === REMINDER_24H_RESUME ===
  REMINDER_24H_RESUME: {tag: "remind_resume"},

  // === REMINDER_48H_RESUME ===
  REMINDER_48H_RESUME: {tag: "remind_resume"},

  // === RESUME_LAST ===
  RESUME_LAST: {tag: "resume_last"},

  // === LOCKED_TRAINING_INFO ===
  LOCKED_TRAINING_INFO: {tag: "locked_training"},

  // === LOCKED_CRM_INFO ===
  LOCKED_CRM_INFO: {image: `${STORAGE_BUCKET_URL}/crm_locked.jpg`, tag: "locked_crm"},

  // === LOCKED_PRO_TRAINING_INFO ===
  LOCKED_PRO_TRAINING_INFO: {tag: "locked_pro_training"},

  // === LOCKED_PLANS_INFO ===
  LOCKED_PLANS_INFO: {tag: "locked_plans"},

  // === EDIT_PROFILE ===
  EDIT_PROFILE: {tag: "profile_view"},

  // === CHESTS_INVENTORY ===
  CHESTS_INVENTORY: {image: `${STORAGE_BUCKET_URL}/inventory.jpg`, tag: "inventory_view"},
};
