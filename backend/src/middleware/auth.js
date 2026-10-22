const User = require("../models/User");
const { verifyToken } = require("../utils/jwt");

function extractBearerToken(req) {
  const header = req.header("authorization");
  if (!header || typeof header !== "string") return "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

async function authenticate(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token)
      return res.status(401).json({ error: "authentication required" });

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user || !user.active)
      return res.status(401).json({ error: "invalid user" });

    req.user = user;
    return next();
  } catch (error) {
    if (
      error?.name === "JsonWebTokenError" ||
      error?.name === "TokenExpiredError"
    ) {
      return res.status(401).json({ error: "invalid token" });
    }
    return next(error);
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ error: "authentication required" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "forbidden" });
    next();
  };
}

module.exports = { authenticate, authorize };
