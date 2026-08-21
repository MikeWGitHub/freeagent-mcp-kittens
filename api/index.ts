/**
 * FreeAgent MCP Server with Full OAuth Proxy
 *
 * This server acts as a complete OAuth Authorization Server that proxies to FreeAgent:
 * 1. Claude connects and discovers OAuth endpoints
 * 2. Users are redirected to FreeAgent for login
 * 3. FreeAgent redirects back with auth code
 * 4. We exchange for FreeAgent tokens and issue MCP tokens
 * 5. MCP tokens are mapped to FreeAgent tokens for API calls
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createFreeAgentJWTOAuthProvider, getFreeAgentTokenFromJWT } from "../src/services/oauth-jwt.js";
import { FreeAgentApiClient } from "../src/services/api-client.js";
import type { RefreshConfig } from "../src/services/api-client.js";
import { getBaseUrl, SERVER_VERSION } from "../src/constants.js";
import { registerAllTools } from "../src/tools/register.js";
import {
  assertStaticBearerConfig,
  extractBearerToken,
  getCachedFreeAgentAccessToken,
  isStaticBearerConfigured,
  parseStaticScope,
  staticBearerMatches,
} from "../src/services/static-bearer.js";
import type { McpStaticScope } from "../src/services/static-bearer.js";

// Fail closed: a configured static bearer without a refresh token is broken,
// matching the JWT_SECRET check in oauth-jwt.ts.
assertStaticBearerConfig();

// Configuration
const USE_SANDBOX = process.env.FREEAGENT_USE_SANDBOX === "true";

const BASE_URL = getBaseUrl();

// Create Express app
const app = express();

// Enable trust proxy for Vercel (required for X-Forwarded-For headers)
// Vercel is 1 proxy hop away, so we trust the first proxy
app.set('trust proxy', 1);

app.use(express.json());

// Create JWT-based OAuth provider (stateless)
const oauthProvider = createFreeAgentJWTOAuthProvider();

// Add error logging for OAuth token endpoint
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/token') {
    const originalJson = res.json.bind(res);

    // Only log errors, not successful requests
    res.json = function(body: unknown) {
      if (body && typeof body === "object" && "error" in body) {
        const errBody = body as { error?: unknown; error_description?: unknown };
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          component: "oauth-token-error",
          message: "Token endpoint error",
          data: {
            grantType: req.body?.grant_type,
            error: errBody.error,
            errorDescription: errBody.error_description,
          }
        }));
      }
      return originalJson(body);
    };
  }
  next();
});

// Install full OAuth router (provides /authorize, /token, /register, etc.)
app.use(mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: new URL(BASE_URL),
  baseUrl: new URL(BASE_URL),
  serviceDocumentationUrl: new URL("https://dev.freeagent.com/docs/oauth"),
  scopesSupported: ["freeagent"],
  resourceName: "FreeAgent MCP Server",
  resourceServerUrl: new URL(BASE_URL),
}));

// OAuth callback handler (receives redirect from FreeAgent)
app.get("/oauth/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(`FreeAgent authorization failed: ${error}`);
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      return res.status(400).send("Invalid callback parameters");
    }

    // Handle the FreeAgent callback
    const result = await oauthProvider.handleFreeAgentCallback(state, code);

    // Redirect back to Claude with our authorization code
    const redirectUrl = new URL(result.redirectUri);
    redirectUrl.searchParams.set("code", result.code);
    if (result.state) {
      redirectUrl.searchParams.set("state", result.state);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send(`Callback error: ${error}`);
  }
});

interface McpRequest extends Request {
  mcpAuthMode?: "static" | "jwt";
}

function staticRefreshConfig(): RefreshConfig | undefined {
  const clientId = process.env.FREEAGENT_CLIENT_ID;
  const clientSecret = process.env.FREEAGENT_CLIENT_SECRET;
  const refreshToken = process.env.FREEAGENT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return undefined;
  return { clientId, clientSecret, refreshToken };
}

// Create MCP server with tools
function createMcpServer(
  freeagentToken: string,
  options?: { scope?: McpStaticScope; refreshConfig?: RefreshConfig }
): McpServer {
  const server = new McpServer({
    name: "freeagent-mcp-server",
    version: SERVER_VERSION
  });

  const apiClient = new FreeAgentApiClient(freeagentToken, USE_SANDBOX, options?.refreshConfig);
  registerAllTools(server, apiClient, { scope: options?.scope ?? "full" });

  return server;
}

// Shared MCP request handler - creates a stateless server per request
const bearerAuth = requireBearerAuth({
  verifier: oauthProvider,
  resourceMetadataUrl: `${BASE_URL}/.well-known/oauth-protected-resource`
});

function mcpAuth(req: McpRequest, res: Response, next: NextFunction): void {
  const presented = extractBearerToken(req.headers.authorization);
  if (presented && staticBearerMatches(presented)) {
    req.mcpAuthMode = "static";
    next();
    return;
  }
  bearerAuth(req, res, next);
}

async function handleMcpRequest(req: McpRequest, res: Response) {
  try {
    const mcpToken = extractBearerToken(req.headers.authorization);
    if (!mcpToken) {
      return res.status(401).json({ error: "No authorization token" });
    }

    let freeagentToken: string | undefined;
    let scope: McpStaticScope = "full";
    let refreshConfig: RefreshConfig | undefined;

    if (req.mcpAuthMode === "static") {
      freeagentToken = await getCachedFreeAgentAccessToken();
      scope = parseStaticScope(process.env.MCP_STATIC_SCOPE);
      refreshConfig = staticRefreshConfig();
    } else {
      freeagentToken = getFreeAgentTokenFromJWT(mcpToken);
    }

    if (!freeagentToken) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const server = createMcpServer(freeagentToken, { scope, refreshConfig });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode - no sessions needed for serverless
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP endpoint error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

// MCP endpoints - POST for tool calls, GET for SSE stream, DELETE returns 405 (stateless)
for (const path of ["/mcp", "/"]) {
  app.post(path, mcpAuth, handleMcpRequest);
  app.get(path, mcpAuth, handleMcpRequest);
  app.delete(path, (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method not allowed - server is stateless, no sessions to terminate" });
  });
}

// Health check
app.get("/health", (_req: Request, res: Response) => {
  const staticBearer = isStaticBearerConfigured();
  res.json({
    status: "ok",
    service: "freeagent-mcp-server",
    version: SERVER_VERSION,
    oauth_mode: "jwt-stateless",
    static_bearer: staticBearer,
    ...(staticBearer ? { static_bearer_scope: parseStaticScope(process.env.MCP_STATIC_SCOPE) } : {}),
    freeagent_environment: USE_SANDBOX ? "sandbox" : "production",
  });
});

export default app;
