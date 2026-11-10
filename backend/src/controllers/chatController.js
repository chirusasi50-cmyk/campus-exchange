import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Listing from "../models/Listing.js";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import cloudinary, { isCloudinaryConfigured } from "../config/cloudinary.js";

const participantIds = (conversation) => conversation.participants?.length
  ? conversation.participants
  : [conversation.buyer, conversation.seller].filter(Boolean);
export const getConversationParticipantIds = participantIds;
const isParticipant = (conversation, userId) => participantIds(conversation).some((id) => id.toString() === userId.toString());
const roomName = (id) => `conversation:${id}`;
const allowedReactions = new Set(["👍", "❤️", "😂", "😮", "😢", "🎉"]);
function emitToConversationUsers(io, conversation, event, payload) {
  if (!io) return;
  for (const participantId of new Set(participantIds(conversation).map(String))) {
    io.to(`user:${participantId}`).emit(event, payload);
  }
}

export function emitConversationRead(io, conversation, readerId, payload) {
  if (!io) return;
  io.to(roomName(conversation._id)).emit("messages:read", payload);
  for (const participantId of new Set(participantIds(conversation).map(String))) {
    if (participantId !== readerId.toString()) io.to(`user:${participantId}`).emit("messages:read", payload);
  }
}

async function populateMessage(message) {
  await message.populate("sender", "name");
  await message.populate({
    path: "replyTo",
    select: "text content sender deletedAt isDeleted attachment.filename",
    populate: { path: "sender", select: "name" },
  });
  return message;
}

async function loadParticipantConversation(id, userId) {
  if (!mongoose.isValidObjectId(id)) return null;
  const conversation = await Conversation.findById(id);
  return conversation && isParticipant(conversation, userId) ? conversation : null;
}

function toPublicMessage(message) {
  const value = message?.toObject ? message.toObject() : { ...message };
  value.text ||= value.content || "";
  value.editedAt ||= value.edited ? value.updatedAt || null : null;
  value.deletedAt ||= value.isDeleted ? value.updatedAt || null : null;
  if (value.deletedAt || value.isDeleted) {
    value.text = "This message was deleted";
    value.content = value.text;
  }
  delete value.forwardedFrom;
  if (value.attachment) delete value.attachment.publicId;
  if (value.replyTo && typeof value.replyTo === "object") {
    value.replyTo.text ||= value.replyTo.content || "";
    value.replyTo.deletedAt ||= value.replyTo.isDeleted ? value.replyTo.updatedAt || null : null;
    if (value.replyTo.deletedAt) value.replyTo.text = "This message was deleted";
  }
  return value;
}

export const listConversations = async (req, res) => {
  const conversations = await Conversation.find({ $or: [
    { participants: req.user._id },
    { buyer: req.user._id },
    { seller: req.user._id },
  ] })
    .populate("participants", "name role")
    .populate("buyer", "name role")
    .populate("seller", "name role")
    .populate("listing", "title image price")
    .populate({ path: "lastMessage", populate: { path: "sender", select: "name" } })
    .sort({ updatedAt: -1 });
  const unreadCounts = await Message.aggregate([
    { $match: { conversation: { $in: conversations.map((conversation) => conversation._id) }, sender: { $ne: req.user._id }, readAt: null, isDeleted: { $ne: true } } },
    { $group: { _id: "$conversation", count: { $sum: 1 } } },
  ]);
  const unreadByConversation = new Map(unreadCounts.map(({ _id, count }) => [_id.toString(), count]));
  res.json({ conversations: conversations.map((conversation) => {
    const value = conversation.toObject();
    value.participants = value.participants?.length ? value.participants : [value.buyer, value.seller].filter(Boolean);
    if (value.lastMessage) value.lastMessage = toPublicMessage(value.lastMessage);
    value.unreadCount = unreadByConversation.get(conversation.id) || 0;
    return value;
  }) });
};

export const getConversations = listConversations;

export const createConversation = async (req, res) => {
  const { listingId } = req.body;
  if (!mongoose.isValidObjectId(listingId)) return res.status(400).json({ message: "Valid listingId is required" });
  const listing = await Listing.findById(listingId);
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.owner.toString() === req.user._id.toString()) return res.status(400).json({ message: "You cannot start a conversation with yourself" });
  const participants = [listing.owner, req.user._id];
  const participantKey = participants.map((id) => id.toString()).sort().join(":");
  const query = { listing: listing._id, $or: [
    { participantKey },
    { buyer: req.user._id, seller: listing.owner },
    { buyer: listing.owner, seller: req.user._id },
  ] };
  let conversation = await Conversation.findOne(query);
  if (!conversation) {
    try {
      conversation = await Conversation.create({
        listing: listing._id,
        participants,
        participantKey,
        buyer: req.user._id,
        seller: listing.owner,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      conversation = await Conversation.findOne(query);
    }
  }
  await conversation.populate(["participants", "buyer", "seller", "listing"]);
  if (!conversation.participants?.length) conversation.participants = [conversation.buyer, conversation.seller].filter(Boolean);
  res.status(200).json({ conversation });
};

export const getMessages = async (req, res) => {
  const conversation = await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  const unreadMessages = await Message.find({
    conversation: conversation._id,
    sender: { $ne: req.user._id },
    readAt: null,
    isDeleted: { $ne: true },
  }).select("_id");
  const readAt = new Date();
  const unreadIds = unreadMessages.map((message) => message._id);
  if (unreadIds.length) {
    await Message.updateMany(
      { _id: { $in: unreadIds } },
      { $addToSet: { readBy: req.user._id }, $set: { readAt } }
    );
    await Message.updateMany(
      { _id: { $in: unreadIds }, deliveredAt: null },
      { $set: { deliveredAt: readAt } }
    );
  }
  const messageDocuments = await Message.find({ conversation: conversation._id })
    .populate("sender", "name")
    .populate({ path: "replyTo", select: "text content sender deletedAt isDeleted attachment.filename", populate: { path: "sender", select: "name" } })
    .sort({ createdAt: 1 });
  const messages = messageDocuments.map(toPublicMessage);
  if (unreadIds.length) {
    emitConversationRead(req.app.get("io"), conversation, req.user._id, {
      conversationId: conversation.id,
      userId: req.user.id,
      readerId: req.user.id,
      messageIds: unreadIds.map((id) => id.toString()),
      readAt,
    });
  }
  res.json({ messages });
};

export const sendMessage = async (req, res) => {
  const conversation = await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  const text = typeof req.body.text === "string" ? req.body.text.trim()
    : typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!text || text.length > 4000) return res.status(400).json({ message: "Message must be between 1 and 4000 characters" });
  let replyTo = null;
  if (req.body.replyTo) {
    if (!mongoose.isValidObjectId(req.body.replyTo)) return res.status(400).json({ message: "Invalid reply target" });
    replyTo = await Message.findOne({ _id: req.body.replyTo, conversation: conversation._id, deletedAt: null }).select("_id");
    if (!replyTo) return res.status(404).json({ message: "Reply target not found" });
  }
  const message = await Message.create({ conversation: conversation._id, sender: req.user._id, text, content: text, replyTo: replyTo?._id || null, readBy: [req.user._id] });
  conversation.lastMessage = message._id;
  conversation.lastMessageAt = message.createdAt;
  conversation.updatedAt = new Date();
  await conversation.save();
  await populateMessage(message);
  const publicMessage = toPublicMessage(message);
  emitToConversationUsers(req.app.get("io"), conversation, "message:new", { ...publicMessage, conversationId: conversation.id, message: publicMessage });
  res.status(201).json({ message: publicMessage, newMessage: publicMessage });
};

export const searchMessages = async (req, res) => {
  const conversation = await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query || query.length > 100) return res.status(400).json({ message: "Search text must be between 1 and 100 characters" });
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const messages = await Message.find({
    conversation: conversation._id,
    deletedAt: null,
    $or: [
      { text: { $regex: escapedQuery, $options: "i" } },
      { content: { $regex: escapedQuery, $options: "i" } },
      { "attachment.filename": { $regex: escapedQuery, $options: "i" } },
    ],
  })
    .populate("sender", "name")
    .populate({ path: "replyTo", select: "text content sender deletedAt isDeleted attachment.filename", populate: { path: "sender", select: "name" } })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json({ messages: messages.map(toPublicMessage) });
};

export const toggleReaction = async (req, res) => {
  const conversation = await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: "Invalid message ID" });
  const emoji = typeof req.body.emoji === "string" ? req.body.emoji : "";
  if (!allowedReactions.has(emoji)) return res.status(400).json({ message: "Unsupported reaction" });
  const message = await Message.findOne({ _id: req.params.messageId, conversation: conversation._id, deletedAt: null, isDeleted: { $ne: true } });
  if (!message) return res.status(404).json({ message: "Message not found" });
  const current = message.reactions.find((reaction) => reaction.user.toString() === req.user._id.toString());
  if (current?.emoji === emoji) {
    message.reactions = message.reactions.filter((reaction) => reaction.user.toString() !== req.user._id.toString());
  } else if (current) {
    current.emoji = emoji;
  } else {
    message.reactions.push({ user: req.user._id, emoji });
  }
  await message.save();
  const reactions = message.reactions.map((reaction) => ({ user: reaction.user.toString(), emoji: reaction.emoji }));
  const update = { conversationId: conversation.id, messageId: message.id, reactions };
  emitToConversationUsers(req.app.get("io"), conversation, "message:reactions", update);
  res.json(update);
};

export const forwardMessage = async (req, res) => {
  const sourceConversation = await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!sourceConversation) return res.status(404).json({ message: "Conversation not found" });
  const { targetConversationId } = req.body;
  if (!mongoose.isValidObjectId(targetConversationId)) return res.status(400).json({ message: "Valid target conversation is required" });
  if (targetConversationId === sourceConversation.id) return res.status(400).json({ message: "Choose another conversation" });
  const targetConversation = await loadParticipantConversation(targetConversationId, req.user._id);
  if (!targetConversation) return res.status(404).json({ message: "Target conversation not found" });
  if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: "Invalid message ID" });
  const sourceMessage = await Message.findOne({ _id: req.params.messageId, conversation: sourceConversation._id, deletedAt: null, isDeleted: { $ne: true } })
    .select("+attachment.publicId +forwardedFrom");
  if (!sourceMessage) return res.status(404).json({ message: "Message not found" });
  const attachment = sourceMessage.attachment?.toObject();
  if (attachment) {
    delete attachment._id;
    attachment.url = "pending";
  }
  const forwarded = new Message({
    conversation: targetConversation._id,
    sender: req.user._id,
    text: sourceMessage.text || sourceMessage.content || "",
    content: sourceMessage.text || sourceMessage.content || "",
    attachment: attachment || null,
    forwardedFrom: sourceMessage._id,
    isForwarded: true,
    readBy: [req.user._id],
  });
  if (forwarded.attachment) {
    forwarded.attachment.url = `/api/chat/conversations/${targetConversation.id}/messages/${forwarded.id}/attachments/${forwarded.attachment.id}`;
  }
  await forwarded.save();
  targetConversation.lastMessage = forwarded._id;
  targetConversation.lastMessageAt = forwarded.createdAt;
  targetConversation.updatedAt = new Date();
  await targetConversation.save();
  await populateMessage(forwarded);
  const publicMessage = toPublicMessage(forwarded);
  emitToConversationUsers(req.app.get("io"), targetConversation, "message:new", { ...publicMessage, conversationId: targetConversation.id, message: publicMessage });
  res.status(201).json({ message: publicMessage, newMessage: publicMessage });
};

const safeAttachmentFilename = (filename) => filename
  .replaceAll("\\", "_")
  .split("/")
  .pop()
  .replace(/[\u0000-\u001f\u007f]/g, "_")
  .trim()
  .slice(0, 255) || "attachment";

const fileMatchesMimeType = (buffer, mimeType, filename) => {
  const extension = safeAttachmentFilename(filename).toLowerCase().match(/\.[^.]+$/)?.[0];
  const expectedExtensions = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "application/pdf": [".pdf"],
  };
  if (!expectedExtensions[mimeType]?.includes(extension)) return false;
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (mimeType === "application/pdf") return buffer.toString("ascii", 0, 5) === "%PDF-";
  return false;
};

function uploadPrivateAsset(file, conversationId, filename) {
  const isPdf = file.mimetype === "application/pdf";
  const resourceType = isPdf ? "raw" : "image";
  const extension = isPdf ? ".pdf" : "";
  const publicId = `campus-exchange/chat/${conversationId}/${randomUUID()}${extension}`;
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: resourceType,
      type: "authenticated",
      public_id: publicId,
      overwrite: false,
      filename_override: filename,
      use_filename: false,
      unique_filename: false,
    }, (error, result) => error ? reject(error) : resolve({ result, resourceType }));
    stream.end(file.buffer);
  });
}

export const sendAttachment = async (req, res) => {
  const conversation = req.conversation || await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  if (!req.file) return res.status(400).json({ message: "Choose a JPG, PNG, WEBP, or PDF file" });
  if (req.file.size > 10 * 1024 * 1024) return res.status(413).json({ message: "Attachments must be 10 MB or smaller" });
  if (!fileMatchesMimeType(req.file.buffer, req.file.mimetype, req.file.originalname)) {
    return res.status(400).json({ message: "The file content does not match its type" });
  }
  if (!isCloudinaryConfigured()) {
    return res.status(503).json({ message: "Cloudinary storage is not configured on the server" });
  }
  const text = typeof req.body.text === "string" ? req.body.text.trim()
    : typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (text.length > 4000) return res.status(400).json({ message: "Message text cannot exceed 4000 characters" });
  let replyTo = null;
  if (req.body.replyTo) {
    if (!mongoose.isValidObjectId(req.body.replyTo)) return res.status(400).json({ message: "Invalid reply target" });
    replyTo = await Message.findOne({ _id: req.body.replyTo, conversation: conversation._id, deletedAt: null, isDeleted: { $ne: true } }).select("_id");
    if (!replyTo) return res.status(404).json({ message: "Reply target not found" });
  }

  let uploaded;
  let message;
  try {
    const safeFilename = safeAttachmentFilename(req.file.originalname);
    uploaded = await uploadPrivateAsset(req.file, conversation.id, safeFilename);
    message = new Message({
      conversation: conversation._id,
      sender: req.user._id,
      text,
      content: text,
      replyTo: replyTo?._id || null,
      attachment: {
        filename: safeFilename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: "pending",
        publicId: uploaded.result.public_id,
        format: uploaded.result.format || (req.file.mimetype === "application/pdf" ? "pdf" : req.file.mimetype.split("/")[1]),
        resourceType: uploaded.resourceType,
      },
      readBy: [req.user._id],
    });
    message.attachment.url = `/api/chat/conversations/${conversation.id}/messages/${message.id}/attachments/${message.attachment.id}`;
    await message.save();
    await populateMessage(message);
    conversation.lastMessage = message._id;
    conversation.lastMessageAt = message.createdAt;
    conversation.updatedAt = new Date();
    await conversation.save();
    const publicMessage = toPublicMessage(message);
    emitToConversationUsers(req.app.get("io"), conversation, "message:new", { ...publicMessage, conversationId: conversation.id, message: publicMessage });
    return res.status(201).json({ message: publicMessage, newMessage: publicMessage });
  } catch (error) {
    if (message?._id) await Message.deleteOne({ _id: message._id }).catch(() => {});
    if (uploaded?.result?.public_id) {
      cloudinary.uploader.destroy(uploaded.result.public_id, {
        resource_type: uploaded.resourceType,
        type: "authenticated",
      }).catch(() => {});
    }
    console.error("Attachment upload error:", error.message);
    return res.status(502).json({ message: "Unable to upload attachment" });
  }
};

export const getAttachmentContent = async (req, res) => {
  const conversation = await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Attachment not found" });
  const message = await Message.findOne({
    _id: req.params.messageId,
    conversation: conversation._id,
    deletedAt: null,
    isDeleted: { $ne: true },
  }).select("+attachment.publicId");
  const attachment = message?.attachment;
  if (!attachment || attachment._id.toString() !== req.params.attachmentId) {
    return res.status(404).json({ message: "Attachment not found" });
  }
  if (!isCloudinaryConfigured()) return res.status(503).json({ message: "Cloudinary storage is not configured on the server" });

  try {
    const signedUrl = cloudinary.utils.private_download_url(attachment.publicId, attachment.format, {
      resource_type: attachment.resourceType,
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 90,
    });
    const upstream = await fetch(signedUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ message: "Unable to retrieve attachment from cloud storage" });
    }
    const isDownload = req.query.download === "1";
    const safeFilename = attachment.filename.replace(/[\r\n"\\]/g, "_");
    res.status(200);
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Length", attachment.size);
    res.setHeader("Content-Disposition", `${isDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error("Attachment retrieval error:", error.message);
    return res.status(502).json({ message: "Unable to retrieve attachment" });
  }
};

export const requireConversationParticipant = async (req, res, next) => {
  const conversation = await loadParticipantConversation(req.params.conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  req.conversation = conversation;
  return next();
};

export const editMessage = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: "Invalid message ID" });
  const message = await Message.findById(req.params.messageId);
  if (!message || message.deletedAt || message.isDeleted || message.sender.toString() !== req.user._id.toString()) {
    return res.status(404).json({ message: "Message not found or cannot be edited" });
  }
  const conversationId = req.params.conversationId || message.conversation;
  if (message.conversation.toString() !== conversationId.toString()) return res.status(404).json({ message: "Message not found" });
  const conversation = await loadParticipantConversation(conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  const text = typeof req.body.text === "string" ? req.body.text.trim()
    : typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!text || text.length > 4000) return res.status(400).json({ message: "Message must be between 1 and 4000 characters" });
  message.text = text;
  message.content = text;
  message.editedAt = new Date();
  message.edited = true;
  await message.save();
  await message.populate("sender", "name");
  const publicMessage = toPublicMessage(message);
  const io = req.app.get("io");
  emitToConversationUsers(io, conversation, "message:updated", { conversationId: conversation.id, message: publicMessage });
  emitToConversationUsers(io, conversation, "message:edited", publicMessage);
  res.json({ message: publicMessage, updatedMessage: publicMessage, messageText: "Message updated successfully" });
};

export const deleteMessage = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: "Invalid message ID" });
  const message = await Message.findById(req.params.messageId);
  if (!message || message.deletedAt || message.isDeleted || message.sender.toString() !== req.user._id.toString()) {
    return res.status(404).json({ message: "Message not found or cannot be deleted" });
  }
  const conversationId = req.params.conversationId || message.conversation;
  if (message.conversation.toString() !== conversationId.toString()) return res.status(404).json({ message: "Message not found" });
  const conversation = await loadParticipantConversation(conversationId, req.user._id);
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  message.deletedAt = new Date();
  message.text = "This message was deleted";
  message.content = message.text;
  message.isDeleted = true;
  message.edited = false;
  message.editedAt = null;
  await message.save();
  await message.populate("sender", "name");
  const publicMessage = toPublicMessage(message);
  const io = req.app.get("io");
  emitToConversationUsers(io, conversation, "message:updated", { conversationId: conversation.id, message: publicMessage });
  emitToConversationUsers(io, conversation, "message:deleted", publicMessage);
  res.json({ message: publicMessage, deletedMessage: publicMessage, deletedMessageId: publicMessage._id });
};

export const markMessagesRead = async (req, res) => {
  const result = await markConversationRead(req.params.conversationId, req.user._id);
  if (!result) return res.status(404).json({ message: "Conversation not found" });
  const event = {
    conversationId: result.conversation.id,
    userId: req.user.id,
    readerId: req.user.id,
    messageIds: result.messageIds,
    readAt: result.readAt,
  };
  emitConversationRead(req.app.get("io"), result.conversation, req.user._id, event);
  res.json({ message: "Messages marked as read", modifiedCount: result.messageIds.length, readAt: result.readAt });
};

export const authorizeConversationRoom = async (socket, conversationId) => loadParticipantConversation(conversationId, socket.data.userId);
export const markMessageDelivered = async (conversationId, messageId, recipientId) => {
  const conversation = await loadParticipantConversation(conversationId, recipientId);
  if (!conversation || !mongoose.isValidObjectId(messageId)) return null;
  const deliveredAt = new Date();
  const message = await Message.findOneAndUpdate(
    {
      _id: messageId,
      conversation: conversation._id,
      sender: { $ne: recipientId },
      deliveredAt: null,
      deletedAt: null,
      isDeleted: { $ne: true },
    },
    { $set: { deliveredAt } },
    { new: true }
  );
  return message ? { conversation, message } : null;
};
export const markConversationRead = async (conversationId, readerId) => {
  const conversation = await loadParticipantConversation(conversationId, readerId);
  if (!conversation) return null;
  const readAt = new Date();
  const unread = await Message.find({
    conversation: conversation._id,
    sender: { $ne: readerId },
    readAt: null,
    isDeleted: { $ne: true },
  }).select("_id");
  const messageIds = unread.map(({ _id }) => _id.toString());
  if (messageIds.length) {
    await Message.updateMany({ _id: { $in: unread.map(({ _id }) => _id) } }, {
      $addToSet: { readBy: readerId },
      $set: { readAt, deliveredAt: readAt },
    });
  }
  return { conversation, messageIds, readAt };
};
export { roomName };
