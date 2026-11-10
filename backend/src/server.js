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

// ========================================
// EXPRESS APP AND HTTP SERVER
// ========================================

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

// ========================================
// CORS CONFIGURATION
// ========================================

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://localhost:5174",
]
  .filter(Boolean)
  .flatMap((origin) => origin.split(",").map((item) => item.trim()));
  .filter(Boolean)
  .flatMap((origin) =>
    origin.split(",").map((item) => item.trim())
  );

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-api-key",
  ],

  credentials: true,
};

app.use(cors(corsOptions));

// ========================================
// SECURITY MIDDLEWARE
// ========================================

app.use(helmet());

app.use(express.json({ limit: "3mb" }));

// ========================================
// RATE LIMITING
// ========================================

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

// ========================================
// SOCKET.IO CONFIGURATION
// ========================================

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ========================================
// SOCKET.IO JWT AUTHENTICATION
// ========================================

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    if (!process.env.JWT_SECRET) {
      return next(
        new Error("Server authentication configuration error")
      );
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

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

// ========================================
// SOCKET CONNECTION
// ========================================

io.on("connection", (socket) => {
  const userId = socket.data.userId;

  // Join private user room
  socket.join(`user:${userId}`);

  console.log(`Chat socket connected: ${userId}`);

  socket.on("disconnect", () => {
    console.log(`Chat socket disconnected: ${userId}`);
  });
});

// Make Socket.IO available in controllers
app.set("io", io);

// ========================================
// ROOT ROUTE
// ========================================

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Campus Exchange API is running",
  });
});

// ========================================
// HEALTH CHECK
// ========================================

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    application: "Campus Exchange",
  });
});

// ========================================
// API ROUTES
// ========================================

app.use("/api/auth", authRoutes);

app.use("/api/listings", listingRoutes);

app.use("/api/chat", chatRoutes);

// ========================================
// 404 HANDLER
// ========================================

app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ========================================
// START SERVER
// ========================================

const startServer = async () => {
  try {
    await connectDB();

    const PORT = Number(process.env.PORT) || 5001;

    httpServer.listen(PORT, () => {
      console.log(
        `Campus Exchange API running on port ${PORT}`
      );

      console.log("Socket.IO server initialized");
      console.log("Chat API routes initialized");
    });
  } catch (error) {
    console.error(
      "Failed to start Campus Exchange API:",
      error.message
    );

    process.exit(1);
  }
};

startServer();
