import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Listing from "../models/Listing.js";

// ========================================
// HELPER FUNCTIONS
// ========================================

const isParticipant = (conversation, userId) => {
  return (
    conversation.buyer.toString() === userId.toString() ||
    conversation.seller.toString() === userId.toString()
  );
};

const emitToConversation = (req, conversation, event, data) => {
  const io = req.app.get("io");

  if (!io) return;

  io.to(`user:${conversation.buyer}`)
    .to(`user:${conversation.seller}`)
    .emit(event, data);
};

// ========================================
// CREATE OR GET CONVERSATION
// ========================================

export const createConversation = async (req, res) => {
  try {
    const { listingId } = req.body;

    if (!mongoose.isValidObjectId(listingId)) {
      return res.status(400).json({
        message: "Invalid listing ID",
      });
    }

    const listing = await Listing.findById(listingId);

    if (!listing) {
      return res.status(404).json({
        message: "Listing not found",
      });
    }

    const buyerId = req.user._id;
    const sellerId = listing.owner;

    if (buyerId.toString() === sellerId.toString()) {
      return res.status(403).json({
        message: "You cannot chat with yourself",
      });
    }

    let conversation = await Conversation.findOne({
      listing: listingId,
      buyer: buyerId,
      seller: sellerId,
    });

    if (!conversation) {
      try {
        conversation = await Conversation.create({
          listing: listingId,
          buyer: buyerId,
          seller: sellerId,
        });
      } catch (error) {
        if (error.code !== 11000) throw error;

        conversation = await Conversation.findOne({
          listing: listingId,
          buyer: buyerId,
          seller: sellerId,
        });
      }
    }

    return res.status(200).json({
      message: "Conversation ready",
      conversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error);

    return res.status(500).json({
      message: "Unable to create conversation",
    });
  }
};

// ========================================
// GET ALL USER CONVERSATIONS
// ========================================

export const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      $or: [
        { buyer: req.user._id },
        { seller: req.user._id },
      ],
    })
      .populate("buyer", "name")
      .populate("seller", "name")
      .populate("listing", "title price image")
      .populate("lastMessage")
      .sort({ lastMessageAt: -1 });

    return res.status(200).json({
      conversations,
    });
  } catch (error) {
    console.error("Get conversations error:", error);

    return res.status(500).json({
      message: "Unable to fetch conversations",
    });
  }
};

// ========================================
// GET MESSAGES
// ========================================

export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({
        message: "Invalid conversation ID",
      });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (!isParticipant(conversation, req.user._id)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const messages = await Message.find({
      conversation: conversationId,
    })
      .populate("sender", "name")
      .sort({ createdAt: 1 });

    return res.status(200).json({
      messages,
    });
  } catch (error) {
    console.error("Get messages error:", error);

    return res.status(500).json({
      message: "Unable to fetch messages",
    });
  }
};

// ========================================
// SEND MESSAGE
// ========================================

export const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const content =
      typeof req.body.content === "string"
        ? req.body.content.trim()
        : "";

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({
        message: "Invalid conversation ID",
      });
    }

    if (!content) {
      return res.status(400).json({
        message: "Message cannot be empty",
      });
    }

    if (content.length > 2000) {
      return res.status(400).json({
        message: "Message cannot exceed 2000 characters",
      });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (!isParticipant(conversation, req.user._id)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    let message = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      content,
    });

    conversation.lastMessage = message._id;
    conversation.lastMessageAt = message.createdAt;

    await conversation.save();

    message = await Message.findById(message._id).populate(
      "sender",
      "name"
    );

    emitToConversation(
      req,
      conversation,
      "message:new",
      message
    );

    return res.status(201).json({
      message: "Message sent successfully",
      newMessage: message,
    });
  } catch (error) {
    console.error("Send message error:", error);

    return res.status(500).json({
      message: "Unable to send message",
    });
  }
};

// ========================================
// EDIT MESSAGE
// ========================================

export const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    const content =
      typeof req.body.content === "string"
        ? req.body.content.trim()
        : "";

    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({
        message: "Invalid message ID",
      });
    }

    if (!content) {
      return res.status(400).json({
        message: "Message cannot be empty",
      });
    }

    if (content.length > 2000) {
      return res.status(400).json({
        message: "Message cannot exceed 2000 characters",
      });
    }

    const message = await Message.findById(messageId);

    if (!message || message.isDeleted) {
      return res.status(404).json({
        message: "Message not found",
      });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: "You can only edit your own messages",
      });
    }

    const conversation = await Conversation.findById(
      message.conversation
    );

    if (!conversation || !isParticipant(conversation, req.user._id)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    message.content = content;
    message.edited = true;

    await message.save();

    const updatedMessage = await Message.findById(
      message._id
    ).populate("sender", "name");

    emitToConversation(
      req,
      conversation,
      "message:edited",
      updatedMessage
    );

    return res.status(200).json({
      message: "Message updated successfully",
      updatedMessage,
    });
  } catch (error) {
    console.error("Edit message error:", error);

    return res.status(500).json({
      message: "Unable to edit message",
    });
  }
};

// ========================================
// DELETE MESSAGE
// ========================================

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({
        message: "Invalid message ID",
      });
    }

    const message = await Message.findById(messageId);

    if (!message || message.isDeleted) {
      return res.status(404).json({
        message: "Message not found",
      });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: "You can only delete your own messages",
      });
    }

    const conversation = await Conversation.findById(
      message.conversation
    );

    if (!conversation || !isParticipant(conversation, req.user._id)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    // Soft delete: preserve the message record.
    message.content = "This message was deleted";
    message.isDeleted = true;
    message.edited = false;

    await message.save();

    const deletedMessage = {
      _id: message._id,
      conversation: message.conversation,
      sender: message.sender,
      content: message.content,
      isDeleted: true,
    };

    emitToConversation(
      req,
      conversation,
      "message:deleted",
      deletedMessage
    );

    return res.status(200).json({
      message: "Message deleted successfully",
      deletedMessageId: message._id,
    });
  } catch (error) {
    console.error("Delete message error:", error);

    return res.status(500).json({
      message: "Unable to delete message",
    });
  }
};

// ========================================
// MARK MESSAGES AS READ
// ========================================

export const markMessagesRead = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({
        message: "Invalid conversation ID",
      });
    }

    const conversation = await Conversation.findById(
      conversationId
    );

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (!isParticipant(conversation, req.user._id)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const readAt = new Date();

    const result = await Message.updateMany(
      {
        conversation: conversationId,
        sender: { $ne: req.user._id },
        readAt: null,
        isDeleted: false,
      },
      {
        $set: { readAt },
      }
    );

    const io = req.app.get("io");

    if (io && result.modifiedCount > 0) {
      const readEvent = {
        conversationId,
        readerId: req.user._id.toString(),
        readAt,
      };

      const otherUserId =
        conversation.buyer.toString() === req.user._id.toString()
          ? conversation.seller
          : conversation.buyer;

      io.to(`user:${otherUserId}`).emit(
        "messages:read",
        readEvent
      );
    }

    return res.status(200).json({
      message: "Messages marked as read",
      modifiedCount: result.modifiedCount,
      readAt,
    });
  } catch (error) {
    console.error("Mark messages read error:", error);

    return res.status(500).json({
      message: "Unable to mark messages as read",
    });
  }
};
