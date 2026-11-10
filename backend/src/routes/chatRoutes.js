import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";

import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markMessagesRead,
} from "../controllers/chatController.js";

const router = express.Router();

// All chat routes require authentication.
router.use(authMiddleware);

// Create or retrieve a conversation for a listing.
router.post("/conversations", createConversation);

// Get the logged-in user's conversations.
router.get("/conversations", getConversations);

// Get messages in a conversation.
router.get("/conversations/:conversationId/messages", getMessages);

// Send a message.
router.post("/conversations/:conversationId/messages", sendMessage);

// Edit a message.
router.patch("/messages/:messageId", editMessage);

// Delete a message.
router.delete("/messages/:messageId", deleteMessage);

// Mark received messages as read.
router.patch("/conversations/:conversationId/read", markMessagesRead);

export default router;
