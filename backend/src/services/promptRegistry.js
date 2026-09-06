const fs = require("node:fs/promises");
const path = require("node:path");
const Ajv = require("ajv");

const promptDir = path.resolve(__dirname, "../pre-prompt");
let registry = null;

function extractJsonBlock(markdown, fileName) {
  const match = markdown.match(/```json\s*([\s\S]*?)```/i);
  if (!match) throw new Error(`${fileName} must contain one JSON code block`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${fileName} contains invalid JSON: ${error.message}`);
  }
}

async function loadAgentPrompts() {
  const [systemPrompt, capabilitiesMarkdown, protocolMarkdown, toolsMarkdown] =
    await Promise.all([
      fs.readFile(path.join(promptDir, "system.md"), "utf8"),
      fs.readFile(path.join(promptDir, "capabilities.md"), "utf8"),
      fs.readFile(path.join(promptDir, "action-protocol.md"), "utf8"),
      fs.readFile(path.join(promptDir, "tools.md"), "utf8"),
    ]);
  const capabilities = extractJsonBlock(
    capabilitiesMarkdown,
    "capabilities.md",
  );
  const protocolSchema = extractJsonBlock(
    protocolMarkdown,
    "action-protocol.md",
  );
  const tools = extractJsonBlock(toolsMarkdown, "tools.md");
  if (!Array.isArray(capabilities) || capabilities.length === 0)
    throw new Error("capabilities.md must define at least one action");
  if (!Array.isArray(tools) || tools.length === 0)
    throw new Error("tools.md must define at least one tool");
  const ajv = new Ajv({ allErrors: true, strict: false });
  const capabilityByAction = new Map();
  for (const capability of capabilities) {
    if (
      !capability?.action ||
      !capability?.inputSchema ||
      capabilityByAction.has(capability.action)
    )
      throw new Error("capabilities.md has an invalid or duplicate action");
    capabilityByAction.set(capability.action, {
      ...capability,
      validateArguments: ajv.compile(capability.inputSchema),
    });
  }
  const toolByAction = new Map();
  for (const tool of tools) {
    if (
      !tool?.action ||
      !tool?.effect ||
      !tool?.description ||
      toolByAction.has(tool.action)
    )
      throw new Error("tools.md has an invalid or duplicate tool");
    toolByAction.set(tool.action, tool);
  }
  const capabilityActions = [...capabilityByAction.keys()].sort();
  const toolActions = [...toolByAction.keys()].sort();
  if (capabilityActions.join("|") !== toolActions.join("|"))
    throw new Error(
      "capabilities.md and tools.md must define the same actions",
    );
  const { registeredActions: internalActions } = require("./agentTools");
  const { registeredActions: mcpActions } = require("./mcp/agentMCPTools");
  const implementationActions = [...internalActions, ...mcpActions].sort();
  if (capabilityActions.join("|") !== implementationActions.join("|"))
    throw new Error(
      "capabilities.md and agentTools.js must define the same actions",
    );
  for (const tool of tools) {
    const capability = capabilityByAction.get(tool.action);
    if (tool.effect === "write" && !capability.requiresConfirmation)
      throw new Error(
        `write tool ${tool.action} must require confirmation in capabilities.md`,
      );
  }
  registry = {
    systemPrompt,
    protocolMarkdown,
    protocolSchema,
    capabilities,
    capabilityByAction,
    toolsMarkdown,
    tools,
    toolByAction,
    validatePlan: ajv.compile(protocolSchema),
  };
  console.log(`Agent prompts loaded from ${promptDir}`);
  console.log('Agent capability and system prompt loading has been finished.');
  return registry;
}

async function getAgentPrompts() {
  return registry || loadAgentPrompts();
}
module.exports = { loadAgentPrompts, getAgentPrompts };
