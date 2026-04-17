/**
 * MCP Server for TikTok - Entry Point
 *
 * Delegates tool registration to per-phase handler modules:
 *   Phase 1: OAuth & Authentication (oauth-handlers.ts)
 *   Phase 2: Login Kit              (login-kit-handlers.ts)
 *   Phase 3: Display API            (display-api-handlers.ts)
 *   Phase 4: Content Posting        (content-posting-handlers.ts)
 *   Phase 5: Research API           (research-api-handlers.ts)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './utils/logger.js';
import { registerOAuthHandlers } from './handlers/oauth-handlers.js';
import { registerLoginKitHandlers } from './handlers/login-kit-handlers.js';
import { registerDisplayApiHandlers } from './handlers/display-api-handlers.js';
import { registerContentPostingHandlers } from './handlers/content-posting-handlers.js';
import { registerResearchApiHandlers } from './handlers/research-api-handlers.js';

// Create MCP server instance
const server = new McpServer({ name: 'mcp-tiktok', version: '1.0.0' });

// Register all tool handlers by phase
registerOAuthHandlers(server);
registerLoginKitHandlers(server);
registerDisplayApiHandlers(server);
registerContentPostingHandlers(server);
registerResearchApiHandlers(server);

// Log startup info
logger.info('MCP-TikTok server starting...');
logger.info(`Phase 1: Core Infrastructure & OAuth ✅`);
logger.info(`Phase 2: Login Kit Integration ✅`);
logger.info(`Phase 3: Display API ✅`);
logger.info(`Phase 4: Content Posting API ✅`);
logger.info(`Phase 5: Research API ✅`);

// Start accepting connections
const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('MCP-TikTok server is ready');
