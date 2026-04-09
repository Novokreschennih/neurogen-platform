/**
 * App Authentication Handlers
 * Validates tokens and PIN codes for NeuroGen apps
 * actions: "validate-app-token", "validate-pin"
 */

export async function handleAppAuth(event, context) {
  const { action, ydb, log, verifyToken, generateToken, corsHeaders } = context;

  // === VALIDATE APP TOKEN ===
  if (action === "validate-app-token") {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
      "Content-Type": "application/json",
    };

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ success: false, error: "Method not allowed" }),
      };
    }

    try {
      const body = JSON.parse(event.body);
      const { token } = body;

      if (!token) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: "No token provided" }),
        };
      }

      let jwtToken;
      try {
        let base64 = token.replace(/-/g, "+").replace(/_/g, "/");
        const padding = base64.length % 4;
        if (padding) {
          base64 += "=".repeat(4 - padding);
        }
        jwtToken = Buffer.from(base64, "base64").toString("utf-8");
      } catch (e) {
        log.error(`[APP TOKEN VERIFY] Decode error: ${e.message}`);
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: "Invalid token encoding",
          }),
        };
      }

      let decoded;
      try {
        decoded = verifyToken(jwtToken);
        if (!decoded) throw new Error("Invalid token");
      } catch (err) {
        log.error(`[APP TOKEN VERIFY] JWT verify error: ${err.name} - ${err.message}`);
        throw err;
      }

      const user = await ydb.getUser(decoded.uid);

      if (!user || !user.bought_tripwire) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            success: false,
            error: "PRO status required",
            isPro: false,
          }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: {
            userId: decoded.uid,
            isPro: true,
            firstName: user.first_name,
            apps: decoded.apps || [],
            exp: decoded.exp,
          },
        }),
      };
    } catch (err) {
      log.warn(`[APP TOKEN VERIFY] Error: ${err.message}`);

      if (err.name === "TokenExpiredError") {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: "Token expired",
            expired: true,
          }),
        };
      }

      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ success: false, error: "Invalid token" }),
      };
    }
  }

  // === VALIDATE PIN ===
  if (action === "validate-pin") {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
      "Content-Type": "application/json",
    };

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ success: false, error: "Method not allowed" }),
      };
    }

    try {
      const body = JSON.parse(event.body);
      const { userId, pin } = body;

      if (!userId || !pin) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: "userId and pin required",
          }),
        };
      }

      const user = await ydb.getUser(String(userId));

      if (!user) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: "User not found" }),
        };
      }

      if (!user.bought_tripwire) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({
            success: false,
            error: "PRO status required",
            isPro: false,
          }),
        };
      }

      if (user.pin_code !== String(pin)) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: "Invalid PIN" }),
        };
      }

      const jwtToken = generateToken(
        {
          uid: String(user.user_id),
          isPro: true,
          apps: [
            "viral-video", "bot-scenarios", "master-architect", "landing-pages",
            "web-design", "ads", "deploy", "monetization",
          ],
        },
        { expiresIn: "7d" },
      );

      const encodedToken = Buffer.from(jwtToken)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          token: encodedToken,
          user: {
            userId: user.user_id,
            isPro: true,
            firstName: user.first_name,
            apps: [
              "viral-video", "bot-scenarios", "master-architect", "landing-pages",
              "web-design", "ads", "deploy", "monetization",
            ],
          },
        }),
      };
    } catch (err) {
      log.error(`[PIN VALIDATE] Error: ${err.message}`);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Internal server error",
        }),
      };
    }
  }

  return null;
}
