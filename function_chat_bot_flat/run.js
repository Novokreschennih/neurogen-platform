/**
 * Simple test runner — no dependencies needed
 * Usage: node tests/run.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let total = 0;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  total++;
  if (ok) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
    console.error(`     Expected: ${expected}`);
    console.error(`     Actual:   ${actual}`);
  }
}

function assertThrows(fn, message) {
  total++;
  try {
    fn();
    failed++;
    console.error(`  ❌ ${message} (did not throw)`);
  } catch (e) {
    passed++;
    console.log(`  ✅ ${message}`);
  }
}

async function runTests(name, testFn) {
  console.log(`\n📦 ${name}`);
  try {
    await testFn();
  } catch (e) {
    console.error(`  💥 Test suite crashed: ${e.message}`);
    failed++;
    total++;
  }
}

// ============================================================
// Tests
// ============================================================

await runTests("validator.js", async () => {
  const {
    validatePartnerId,
    validateEmail,
    validateBotToken,
    validateStartPayload,
    validateCallbackData,
    validateState,
    escapeHtml,
  } = await import("../src/utils/validator.js");

  // validatePartnerId
  assertEqual(validatePartnerId("abc123"), "abc123", "valid partner_id");
  assertEqual(validatePartnerId("p_qdr"), "p_qdr", "valid partner_id with underscore");
  assertEqual(validatePartnerId("a"), null, "partner_id too short (1 char)");
  assertEqual(validatePartnerId("ab"), "ab", "partner_id min length (2 chars)");
  assertEqual(validatePartnerId("a".repeat(65)), null, "partner_id too long (65 chars)");
  assertEqual(validatePartnerId("a'. DROP TABLE"), null, "partner_id with SQL injection");
  assertEqual(validatePartnerId("abc<script>"), null, "partner_id with XSS");
  assertEqual(validatePartnerId(""), null, "partner_id empty string");
  assertEqual(validatePartnerId(null), null, "partner_id null");

  // validateEmail
  assertEqual(validateEmail("user@example.com"), "user@example.com", "valid email");
  assertEqual(validateEmail("test.name+tag@domain.co.uk"), "test.name+tag@domain.co.uk", "complex email");
  assertEqual(validateEmail("not-an-email"), null, "no @ symbol");
  assertEqual(validateEmail("user@"), null, "missing domain");
  assertEqual(validateEmail("@domain.com"), null, "missing local part");
  assertEqual(validateEmail("user@domain"), null, "missing TLD");
  assertEqual(validateEmail("user@domain.c"), null, "TLD too short");
  assertEqual(validateEmail("<script>alert(1)</script>@x.com"), null, "XSS in email");
  assertEqual(validateEmail(""), null, "empty email");

  // validateBotToken
  assertEqual(validateBotToken("123456789:ABCdefGHIjklMNOpqrsTUVwxyz"), "123456789:ABCdefGHIjklMNOpqrsTUVwxyz", "valid bot token");
  assertEqual(validateBotToken("123:abc_def-GHI"), "123:abc_def-GHI", "short bot token");
  assertEqual(validateBotToken("not-a-token"), null, "no colon separator");
  assertEqual(validateBotToken("abc:def"), null, "non-numeric ID");
  assertEqual(validateBotToken("123456789:"), null, "empty hash");
  assertEqual(validateBotToken(""), null, "empty token");

  // validateStartPayload
  const result1 = validateStartPayload("abc123");
  assertEqual(result1.partnerId, "abc123", "simple partnerId");
  assertEqual(result1.email, undefined, "no email in simple payload");

  const result2 = validateStartPayload("abc|dXNlckBleGFtcGxlLmNvbQ");
  assertEqual(result2.partnerId, "abc", "payload with encoded email");
  assertEqual(result2.email, "user@example.com", "decoded email");

  const result3 = validateStartPayload("abc|web:a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  assertEqual(result3.partnerId, "abc", "payload with web_id");
  assertEqual(result3.webId, "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "decoded web_id");

  assertEqual(validateStartPayload(null), null, "null payload");
  assertEqual(validateStartPayload(""), null, "empty payload");
  assertEqual(validateStartPayload("<script>"), null, "XSS payload");

  // validateCallbackData
  assertEqual(validateCallbackData("MAIN_MENU"), "MAIN_MENU", "valid callback data");
  assertEqual(validateCallbackData("Offer_Tripwire"), "Offer_Tripwire", "valid with underscore");
  assertEqual(validateCallbackData("abc123"), "abc123", "valid alphanumeric");
  assertEqual(validateCallbackData("DROP TABLE users"), null, "callback with spaces");
  assertEqual(validateCallbackData("alert(1)"), null, "callback with XSS chars");

  // validateState
  assertEqual(validateState("START"), "START", "valid state");
  assertEqual(validateState("Offer_Tripwire"), "Offer_Tripwire", "valid with underscore");
  assertEqual(validateState("  Module_1_Strategy  "), "Module_1_Strategy", "state with whitespace (trimmed)");
  assertEqual(validateState("<script>"), null, "state with XSS");

  // escapeHtml
  assertEqual(escapeHtml("hello"), "hello", "plain text unchanged");
  assertEqual(escapeHtml("<b>bold</b>"), "&lt;b&gt;bold&lt;/b&gt;", "HTML tags escaped");
  assertEqual(escapeHtml("a & b"), "a &amp; b", "ampersand escaped");
  assertEqual(escapeHtml('"quotes"'), "&quot;quotes&quot;", "quotes escaped");
  assertEqual(escapeHtml("it's"), "it&#x27;s", "apostrophe escaped");
  assertEqual(escapeHtml(123), "123", "number to string");
});

await runTests("pin.js", async () => {
  const { generatePin } = await import("../src/utils/pin.js");

  const pin4 = generatePin();
  assertEqual(pin4.length, 4, "default PIN length is 4");
  assert(/^\d{4}$/.test(pin4), "PIN is 4 digits");

  const pin6 = generatePin(6);
  assertEqual(pin6.length, 6, "custom PIN length is 6");
  assert(/^\d{6}$/.test(pin6), "PIN is 6 digits");

  // Check randomness (two calls should differ with very high probability)
  const pin1 = generatePin();
  const pin2 = generatePin();
  // Not asserting they differ (1 in 10000 chance of collision), just logging
  console.log(`  ℹ️  Randomness check: ${pin1} vs ${pin2}${pin1 !== pin2 ? " (different ✓)" : " (collision ⚠️)"}`);
});

await runTests("jwt_utils.js — generateToken + verifyToken", async () => {
  // Set a test secret
  process.env.JWT_SECRET = "test-secret-key-for-jwt-1234567890";

  const { generateToken, verifyToken, decodeToken } = await import("../src/utils/jwt_utils.js");

  // Generate and verify
  const payload = { uid: "12345", isPro: true };
  const token = generateToken(payload, { expiresIn: "1h" });
  assert(typeof token === "string" && token.length > 10, "token is a non-empty string");

  const decoded = verifyToken(token);
  assertEqual(decoded.uid, "12345", "verified token has correct uid");
  assertEqual(decoded.isPro, true, "verified token has correct isPro");
  assert(decoded.exp, "verified token has expiry");

  // Expired token
  const expiredToken = generateToken({ uid: "12345" }, { expiresIn: "0s" });
  const expiredResult = verifyToken(expiredToken);
  assertEqual(expiredResult, null, "expired token returns null");

  // Invalid token
  const invalidResult = verifyToken("invalid.token.here");
  assertEqual(invalidResult, null, "invalid token returns null");

  // Null token
  const nullResult = verifyToken(null);
  assertEqual(nullResult, null, "null token returns null");

  // decodeToken — reads payload without verification
  const decodedWithoutVerify = decodeToken(token);
  assertEqual(decodedWithoutVerify.uid, "12345", "decodeToken extracts uid without verifying");
  assertEqual(decodedWithoutVerify.isPro, true, "decodeToken extracts isPro without verifying");

  // decodeToken invalid
  const decodeInvalid = decodeToken("not-a-jwt");
  assertEqual(decodeInvalid, null, "decodeToken returns null for invalid JWT");

  // decodeToken null
  const decodeNull = decodeToken(null);
  assertEqual(decodeNull, null, "decodeToken returns null for null input");
});

await runTests("ux_helpers.js", async () => {
  const { formatTrainingProgress, detectLoop, getLoopHint, buildChannelSummary } =
    await import("../src/utils/ux_helpers.js");

  // formatTrainingProgress
  const progress = formatTrainingProgress("Module_2_Online", {});
  assert(progress !== null, "progress for Module_2_Online is not null");
  assert(progress.includes("Онлайн"), "progress includes module name");
  assert(progress.includes("Шаг 1/2"), "progress includes step number");
  assert(progress.includes("█░"), "progress bar chars present");

  const noProgress = formatTrainingProgress("START", {});
  assertEqual(noProgress, null, "no progress for START state");

  const proProgress = formatTrainingProgress("Training_Pro_P1_3", {});
  assert(proProgress !== null, "progress for PRO training");
  assert(proProgress.includes("Шаг 4/11"), "PRO progress step count (index 3 → step 4)");

  // detectLoop
  const userWithLoop = {
    session: {
      dialog_history: [
        { role: "user", content: "hello" },
        { role: "user", content: "hello" },
        { role: "user", content: "hello" },
      ],
    },
  };
  assert(detectLoop(userWithLoop, "hello"), "detects loop with 3 identical messages");
  assert(!detectLoop(userWithLoop, "different"), "no loop with different message");

  const userNoHistory = { session: { dialog_history: [] } };
  assert(!detectLoop(userNoHistory, "hello"), "no loop with empty history");

  const userShortHistory = {
    session: {
      dialog_history: [
        { role: "user", content: "hello" },
        { role: "user", content: "hello" },
      ],
    },
  };
  assert(!detectLoop(userShortHistory, "hello"), "no loop with only 2 messages");

  // getLoopHint
  assertEqual(
    getLoopHint("WAIT_VK_GROUP_ID"),
    "💡 Подсказка: зайди в сообщество VK → «Управление» → «Работа с API» → ID указан там (только цифры)",
    "hint for VK group ID",
  );
  assertEqual(getLoopHint("WAIT_EMAIL_INPUT"), "💡 Подсказка: введи email в формате name@example.com", "hint for email");
  assertEqual(getLoopHint("WAIT_BOT_TOKEN"), "💡 Подсказка: токен выглядит как 123456789:ABCdefGHIjklMNOpqrsTUVwxyz (из @BotFather)", "hint for bot token");
  assertEqual(getLoopHint("UNKNOWN_STATE"), null, "no hint for unknown state");

  // buildChannelSummary
  const userWithChannels = {
    session: {
      channels: {
        telegram: { configured: true },
        vk: { configured: true },
        email: { configured: false },
      },
    },
  };
  const summary = buildChannelSummary(userWithChannels, "vk");
  assert(summary.includes("📱 Telegram"), "summary includes Telegram");
  assert(summary.includes("💬 VK"), "summary includes VK");
  assert(!summary.includes("📧 Email"), "summary excludes unconfigured Email");
  assert(summary.includes("💬 VK подключён!"), "summary shows just-configured channel");

  // 3+ channels motivation
  const userWith3Channels = {
    session: {
      channels: {
        telegram: { configured: true },
        vk: { configured: true },
        email: { configured: true },
      },
    },
  };
  const summary3 = buildChannelSummary(userWith3Channels);
  assert(summary3.includes("3+ канала"), "3+ channels motivation present");
  assert(summary3.includes("в 3 раза больше лидов"), "motivation text correct");
});

await runTests("channel_manager.js", async () => {
  const {
    autoDetectChannels,
    getAvailableChannels,
    getNextChannelToSuggest,
    isChannelEnabled,
    getChannelConfig,
    getChannelState,
  } = await import("../src/core/channels/channel_manager.js");

  // autoDetectChannels
  const user = {
    tg_id: 123456,
    vk_id: null,
    web_id: "abc-123",
    email: "test@example.com",
    session: {},
  };
  autoDetectChannels(user);
  assert(isChannelEnabled(user, "telegram"), "telegram auto-detected from tg_id");
  assert(!isChannelEnabled(user, "vk"), "vk NOT auto-detected (no vk_id)");
  assert(isChannelEnabled(user, "web"), "web auto-detected from web_id");
  assert(isChannelEnabled(user, "email"), "email auto-detected from email");

  // getAvailableChannels
  const fullUser = {
    session: {
      channels: {
        telegram: { enabled: true, configured: true },
        email: { enabled: true, configured: true },
      },
    },
  };
  const available = getAvailableChannels(fullUser);
  assert(available.includes("vk"), "vk is available");
  assert(available.includes("web"), "web is available");
  assert(!available.includes("telegram"), "telegram NOT available (already configured)");
  assert(!available.includes("email"), "email NOT available (already configured)");

  // getNextChannelToSuggest
  const nextCh = getNextChannelToSuggest(fullUser);
  assertEqual(nextCh, "vk", "next channel to suggest is vk (first in priority)");

  const allConfiguredUser = {
    session: {
      channels: {
        telegram: { enabled: true, configured: true },
        vk: { enabled: true, configured: true },
        web: { enabled: true, configured: true },
        email: { enabled: true, configured: true },
      },
    },
  };
  const noNext = getNextChannelToSuggest(allConfiguredUser);
  assertEqual(noNext, null, "no channel to suggest when all configured");

  // getChannelState
  const stateUser = {
    state: "START",
    session: {
      channel_states: { telegram: "TG_REG_ID", vk: "VK_GROUP_ID" },
    },
  };
  assertEqual(getChannelState(stateUser, "telegram"), "TG_REG_ID", "telegram channel state");
  assertEqual(getChannelState(stateUser, "vk"), "VK_GROUP_ID", "vk channel state");
  assertEqual(getChannelState(stateUser, "web"), "START", "web channel state falls back to user.state");
});

await runTests("ttl_cache.js", async () => {
  const { createUpdateCache } = await import("../src/utils/ttl_cache.js");

  const cache = createUpdateCache({ max: 3, ttlMs: 100 });

  cache.markProcessed("update_1");
  assert(cache.isProcessed("update_1"), "update_1 is processed");
  assert(!cache.isProcessed("update_2"), "update_2 is not processed");

  cache.markProcessed("update_2");
  cache.markProcessed("update_3");
  cache.markProcessed("update_4"); // Should evict update_1 (max: 3)
  assert(!cache.isProcessed("update_1"), "update_1 evicted (LRU)");
  assert(cache.isProcessed("update_4"), "update_4 is present");
});

// ============================================================
// Summary
// ============================================================

console.log("\n" + "=".repeat(50));
const color = failed > 0 ? "❌" : "✅";
console.log(`${color} ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ""}`);
console.log("=".repeat(50));

process.exit(failed > 0 ? 1 : 0);
