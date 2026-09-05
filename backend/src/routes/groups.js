const express = require("express");
const mongoose = require("mongoose");
const ChatGroup = require("../models/ChatGroup");
const { authenticate } = require("../middleware/auth");
const router = express.Router();
router.use(authenticate);
router.post("/", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const memberIds = Array.isArray(req.body.memberIds)
      ? req.body.memberIds
      : [];
    if (!name || memberIds.some((id) => !mongoose.Types.ObjectId.isValid(id)))
      return res
        .status(400)
        .json({ error: "name and valid memberIds are required" });
    const members = [...new Set([req.user.id, ...memberIds].map(String))];
    const group = await ChatGroup.create({
      name,
      createdBy: req.user.id,
      members,
    });
    req.app.locals.io
      ?.to(members.map((id) => `user:${id}`))
      .emit("group:created", group.toObject());
    res.status(201).json(group);
  } catch (error) {
    next(error);
  }
});
module.exports = router;
