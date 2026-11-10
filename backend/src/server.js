import express from "express";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import connectDB from "./config/db.js";
import User from "./models/User.js";

import authRoutes from "./routes/authRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import { authorizeConversationRoom, emitConversationRead, getConversationParticipantIds, markConversationRead, markMessageDelivered, roomName } from "./controllers/chatController.js";

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

// CORS CONFIGURATION
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
];

if (process.env.CLIENT_URL) {
  const clientUrls = process.env.CLIENT_URL.split(",");

  for (const url of clientUrls) {
    const trimmedUrl = url.trim();

    if (trimmedUrl) {
      try {
        allowedOrigins.push(new URL(trimmedUrl).origin);
      } catch {
        allowedOrigins.push(trimmedUrl);
      }
    }
  }
}

console.log("Allowed CORS origins:", [...new Set(allowedOrigins)]);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error("Blocked CORS origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  credentials: true,
};

app.use(cors(corsOptions));

// SECURITY
app.use(helmet());
app.use(express.json({ limit: "3mb" }));

// RATE LIMITING
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

// SOCKET.IO
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const activeConversationSockets = new Map();

function trackConversationSocket(userId, conversationId, change) {
  let conversations = activeConversationSockets.get(userId);
  if (!conversations && change > 0) {
    conversations = new Map();
    activeConversationSockets.set(userId, conversations);
  }
  if (!conversations) return;
  const count = (conversations.get(conversationId) || 0) + change;
  if (count > 0) conversations.set(conversationId, count);
  else conversations.delete(conversationId);
  if (conversations.size === 0) activeConversationSockets.delete(userId);
}

// SOCKET.IO JWT AUTHENTICATION
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    if (!process.env.JWT_SECRET) {
      return next(new Error("JWT_SECRET is not configured"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return next(new Error("User not found"));
    }

    socket.data.userId = user._id.toString();
    socket.data.userName = user.name;
    socket.data.userRole = user.role;

    next();
  } catch (error) {
    next(new Error("Invalid or expired authentication token"));
  }
});

// SOCKET CONNECTION
io.on("connection", (socket) => {
  const userId = socket.data.userId;

  socket.join(`user:${userId}`);
  socket.data.joinedConversations = new Set();
  socket.data.typingConversations = new Set();

  socket.on("conversation:join", async (conversationId, acknowledge = () => {}) => {
    try {
      const conversation = await authorizeConversationRoom(socket, conversationId);
      if (!conversation) return acknowledge({ error: "Conversation not found" });
      const normalizedConversationId = conversation.id.toString();
      const room = roomName(normalizedConversationId);
      const currentSubscriptions = activeConversationSockets.get(userId);
      const alreadyOnlineInConversation = Boolean(currentSubscriptions?.get(normalizedConversationId));
      socket.join(room);
      if (!socket.data.joinedConversations.has(normalizedConversationId)) {
        socket.data.joinedConversations.add(normalizedConversationId);
        trackConversationSocket(userId, normalizedConversationId, 1);
      }
      const participants = getConversationParticipantIds(conversation).map((participantId) => {
        const participant = participantId.toString();
        const userRoom = io.sockets.adapter.rooms.get(`user:${participant}`);
        return { userId: participant, online: Boolean(userRoom?.size) };
      });
      socket.emit("presence:state", { conversationId: normalizedConversationId, participants });
      if (!alreadyOnlineInConversation) {
        io.to(room).emit("presence:update", { conversationId: normalizedConversationId, userId, online: true });
      }
      acknowledge({ ok: true });
    } catch {
      acknowledge({ error: "Unable to join conversation" });
    }
  });

  socket.on("conversation:leave", (conversationId) => {
    const normalizedConversationId = String(conversationId || "");
    const room = roomName(normalizedConversationId);
    if (socket.data.typingConversations.delete(normalizedConversationId)) {
      socket.to(room).emit("typing:update", { conversationId: normalizedConversationId, userId, typing: false });
    }
    if (socket.data.joinedConversations.delete(normalizedConversationId)) {
      trackConversationSocket(userId, normalizedConversationId, -1);
    }
    socket.leave(room);
  });

  socket.on("typing:set", async ({ conversationId, typing } = {}) => {
    try {
      const conversation = await authorizeConversationRoom(socket, conversationId);
      if (!conversation) return;
      const normalizedConversationId = conversation.id.toString();
      const room = roomName(normalizedConversationId);
      const isTyping = socket.data.typingConversations.has(normalizedConversationId);
      if (typing === true && isTyping) return;
      if (typing !== true && !isTyping) return;
      if (typing === true) socket.data.typingConversations.add(normalizedConversationId);
      else socket.data.typingConversations.delete(normalizedConversationId);
      socket.to(room).emit("typing:update", {
        conversationId: normalizedConversationId,
        userId,
        typing: typing === true,
      });
    } catch {
      // Invalid typing events never grant room access.
    }
  });

  socket.on("message:delivered", async ({ conversationId, messageId } = {}, acknowledge = () => {}) => {
    try {
      const result = await markMessageDelivered(conversationId, messageId, userId);
      if (!result) return acknowledge({ ok: true });
      const receipt = {
        conversationId: result.conversation.id.toString(),
        messageId: result.message.id.toString(),
        deliveredAt: result.message.deliveredAt,
        readAt: result.message.readAt,
      };
      io.to(roomName(receipt.conversationId)).emit("message:receipt", receipt);
      acknowledge({ ok: true });
    } catch {
      acknowledge({ error: "Unable to update delivery status" });
    }
  });

  socket.on("messages:mark-read", async ({ conversationId } = {}, acknowledge = () => {}) => {
    try {
      const normalizedId = String(conversationId || "");
      if (!socket.data.joinedConversations.has(normalizedId)) return acknowledge({ error: "Join the conversation before marking messages read" });
      const result = await markConversationRead(normalizedId, userId);
      if (!result) return acknowledge({ error: "Conversation not found" });
      if (result.messageIds.length) {
        emitConversationRead(io, result.conversation, userId, {
          conversationId: result.conversation.id,
          userId,
          readerId: userId,
          messageIds: result.messageIds,
          readAt: result.readAt,
        });
      }
      acknowledge({ ok: true });
    } catch {
      acknowledge({ error: "Unable to mark messages read" });
    }
  });

  console.log(`Chat socket connected: ${userId}`);

  socket.on("disconnecting", () => {
    const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`);
    const isLastDevice = !userRoom || userRoom.size <= 1;
    if (isLastDevice) {
      const conversations = activeConversationSockets.get(userId);
      for (const conversationId of conversations?.keys() || []) {
        io.to(roomName(conversationId)).emit("presence:update", { conversationId, userId, online: false });
      }
    }
    for (const conversationId of socket.data.typingConversations) {
      socket.to(roomName(conversationId)).emit("typing:update", { conversationId, userId, typing: false });
    }
    for (const conversationId of socket.data.joinedConversations) {
      trackConversationSocket(userId, conversationId, -1);
    }
    socket.data.joinedConversations.clear();
    socket.data.typingConversations.clear();
  });

  socket.on("disconnect", () => {
    console.log(`Chat socket disconnected: ${userId}`);
  });
});

app.set("io", io);

// ROOT ROUTE
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Campus Exchange API is running",
  });
});

// HEALTH CHECK
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    application: "Campus Exchange",
  });
});

// API ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/chat", chatRoutes);

// 404 HANDLER
app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  res.status(status).json({ message: status === 500 ? "Internal server error" : error.message });
});

// START SERVER
const startServer = async () => {
  try {
    await connectDB();

    const PORT = Number(process.env.PORT) || 5001;

    httpServer.listen(PORT, () => {
      console.log(`Campus Exchange API running on port ${PORT}`);
      console.log("Socket.IO initialized");
    });
  } catch (error) {
    console.error("Failed to start API:", error.message);
    process.exit(1);
  }
};

startServer();
