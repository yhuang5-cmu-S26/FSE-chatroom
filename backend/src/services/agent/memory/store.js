const { createHash } = require("node:crypto");
const AgentMemory = require("../../../models/AgentMemory");

const PROFILE_KEY = "explicit-user-facts";

async function getProfile(userId) {
  return AgentMemory.findOne({ userId, kind: "long_term", key: PROFILE_KEY });
}

function memoryId(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

async function rememberExplicitFacts(userId, facts) {
  const values = [
    ...new Set(
      (facts || [])
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (!values.length) return [];
  let profile = await getProfile(userId);
  const current = Array.isArray(profile?.value?.items)
    ? profile.value.items
    : [];
  const byId = new Map(current.map((item) => [item.id, item]));
  const now = new Date().toISOString();
  for (const text of values) {
    const id = memoryId(text);
    byId.set(id, { id, text: text.slice(0, 500), updatedAt: now });
  }
  const items = [...byId.values()].slice(-100);
  if (!profile) {
    profile = await AgentMemory.create({
      userId,
      kind: "long_term",
      key: PROFILE_KEY,
      value: { items },
      version: 1,
    });
  } else {
    profile.value = { items };
    profile.version = Number(profile.version || 0) + 1;
    if (typeof profile.markModified === "function")
      profile.markModified("value");
    await profile.save();
  }
  return items;
}

function terms(text) {
  const normalized = String(text || "").toLowerCase();
  return new Set(normalized.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{1,2}/g) || []);
}

async function searchLongTermMemories(userId, query, limit = 3) {
  const profile = await getProfile(userId);
  const items = Array.isArray(profile?.value?.items) ? profile.value.items : [];
  const queryTerms = terms(query);
  return items
    .map((item) => {
      const itemTerms = terms(item.text);
      let score = 0;
      for (const term of queryTerms)
        if (itemTerms.has(term)) score += term.length;
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
    )
    .slice(0, limit);
}

module.exports = {
  rememberExplicitFacts,
  searchLongTermMemories,
};
