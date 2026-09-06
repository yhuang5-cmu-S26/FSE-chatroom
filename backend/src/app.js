const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const checkinRoutes = require("./routes/checkins");
const postRoutes = require("./routes/posts");
const userRoutes = require("./routes/users");
const stressRoutes = require("./routes/stress");
const authRoutes = require("./routes/auth");
const groupRoutes = require("./routes/groups");
const agentRoutes = require("./routes/agent");

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.get('x-internal-speed-test') === req.app.locals.speedTestInternalToken,
});

app.use(
  cors({
    origin: corsOrigin,
  }),
);
app.use(express.json());
app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/checkins", checkinRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/stress", stressRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "internal server error",
  });
});

module.exports = app;
