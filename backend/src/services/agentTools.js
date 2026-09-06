const UserCheckin = require("../models/UserCheckin");
const Post = require("../models/Post");

const handlers = {
  "checkin.list_absentees": async (action) => {
    const task = await UserCheckin.findById(action.arguments.checkinId);
    if (!task) throw new Error("check-in task not found");
    const checkedIn = new Set((task.checkedInUserIds || []).map(String));
    const absentUserIds = (task.assigneeIds || [])
      .map(String)
      .filter((id) => !checkedIn.has(id));
    return {
      summary: `任务“${task.title}”有 ${absentUserIds.length} 人未签到`,
      data: { taskId: task.id, absentUserIds },
    };
  },
  "post.draft": async (action) => ({
    summary: "已生成帖子草稿",
    data: { draft: `【协作草稿】${action.arguments.topic}` },
  }),
  "post.publish": async (action, actor, { io, idempotencyKey, postModel = Post } = {}) => {
    const existing = idempotencyKey ? await postModel.findOne({ agentIdempotencyKey: idempotencyKey }) : null;
    if (existing) return { summary: "帖子已存在（幂等重试）", data: { postId: existing.id, idempotent: true } };
    let post;
    try {
      post = await postModel.create({ authorId: actor.id, authorName: actor.name, content: action.arguments.content, agentIdempotencyKey: idempotencyKey || undefined });
    } catch (error) {
      if (error?.code !== 11000 || !idempotencyKey) throw error;
      post = await postModel.findOne({ agentIdempotencyKey: idempotencyKey });
      if (!post) throw error;
      return { summary: "帖子已存在（幂等重试）", data: { postId: post.id, idempotent: true } };
    }
    const payload = post.toObject();
    io?.emit("post:created", payload);
    return { summary: "帖子已发布", data: { postId: post.id, idempotent: false } };
  },
  "status.summarize": async () => {
    const [tasks, posts] = await Promise.all([
      UserCheckin.find().lean(),
      Post.find().sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    return {
      summary: `当前有 ${tasks.length} 个签到任务，最近保留 ${posts.length} 条帖子`,
      data: { taskCount: tasks.length, recentPostCount: posts.length },
    };
  },
};

const registeredActions = new Set(Object.keys(handlers));

async function execute(action, actor, context = {}) {
  const handler = handlers[action.type];
  if (!handler)
    throw new Error(`tool implementation is unavailable: ${action.type}`);
  return handler(action, actor, context);
}

module.exports = { execute, registeredActions };
