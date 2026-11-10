import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import attachmentUpload from "../middleware/attachmentUpload.js";
import {
  createConversation,
  deleteMessage,
  editMessage,
  forwardMessage,
  getAttachmentContent,
  getMessages,
  listConversations,
  markMessagesRead,
  requireConversationParticipant,
  searchMessages,
  sendAttachment,
  sendMessage,
  toggleReaction,
} from "../controllers/chatController.js";

const router = express.Router();
router.use(authMiddleware);

router.post("/conversations", createConversation);
router.get("/conversations", listConversations);
router.get("/conversations/:conversationId/messages/search", searchMessages);
router.get("/conversations/:conversationId/messages", getMessages);
router.post("/conversations/:conversationId/messages", sendMessage);
router.post("/conversations/:conversationId/messages/:messageId/reactions", toggleReaction);
router.post("/conversations/:conversationId/messages/:messageId/forward", forwardMessage);
router.post("/conversations/:conversationId/attachments", requireConversationParticipant, attachmentUpload, sendAttachment);
router.get("/conversations/:conversationId/messages/:messageId/attachments/:attachmentId", getAttachmentContent);
router.patch("/conversations/:conversationId/messages/:messageId", editMessage);
router.delete("/conversations/:conversationId/messages/:messageId", deleteMessage);

// Keep the original chat API paths working for existing clients.
router.patch("/messages/:messageId", editMessage);
router.delete("/messages/:messageId", deleteMessage);
router.patch("/conversations/:conversationId/read", markMessagesRead);

export default router;
