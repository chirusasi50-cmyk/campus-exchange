import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import Listing from "../models/Listing.js";

// Check whether the logged-in user belongs to a conversation.
const isParticipant = (conversation, userId) => {
  return (
    conversation.buyer.toString() === userId.toString() ||
    conversation.seller.toString() === userId.toString()
  );
};

// CREATE OR GET CONVERSATION
export const createConversation = async (req, res) => {
  try {
    const { listingId } = req.body;

    if (!mongoose.isValidObjectId(listingId)) {
      return res.status(400).json({ message: "Invalid listing ID" });
    }

    const listing = await Listing.findById(listingId);

    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    const buyerId = req.user._id;
    const sellerId = listing.owner;

    if (buyerId.toString() === sellerId.toString()) {
      return res.status(403).json({
        message: "You cannot start a conversation with yourself",
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
        // Handle simultaneous requests creating the same conversation.
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
    console.error("Create conversation error:", error.message);
    return res.status(500).json({
      message: "Unable to create conversation",
    });
  }
};

// GET ALL USER CONVERSATIONS
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

    return res.status(200).json({ conversations });
  } catch (error) {
    console.error("Get conversations error:", error.message);
    return res.status(500).json({
      message: "Unable to fetch conversations",
    });
  }
};

// GET MESSAGES IN A CONVERSATION
export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation ID" });
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (!isParticipant(conversation, req.user._id)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const messages = await Message.find({
      conversation: conversationId,
    })
      .populate("sender", "name")
      .sort({ createdAt: 1 });

    return res.status(200).json({ messages });
  } catch (error) {
    console.error("Get messages error:", error.message);
    return res.status(500).json({
      message: "Unable to fetch messages",
    });
  }
};

// SEND MESSAGE
export const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const content =
      typeof req.body.content === "string"
        ? req.body.content.trim()
        : "";

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json
