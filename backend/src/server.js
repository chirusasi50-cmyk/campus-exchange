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

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

// Allowed frontend origins
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
]
  .filter(Boolean)
  .flatMap((origin) => origin.split(",").map((item) => item.trim()));

// CORS configuration
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  credentials: true,
};

app.use(cors(corsOptions));

// Security middleware
app.use(helmet());
app.use(express.json({ limit: "3mb" }));

// Rate limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

// Socket.IO configuration
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket authentication using JWT
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    if (!process.env.JWT_SECRET) {
      return next(new Error("Server authentication configuration error"));
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

// Connected users join their private user room
io.on("connection", (socket) => {
  const userId = socket.data.userId;

  socket.join(`user:${userId}`);

  console.log(`Chat socket connected: ${userId}`);

  socket.on("disconnect", () => {
    console.log(`Chat socket disconnected: ${userId}`);
  });
});

// Make Socket.IO available to future chat controllers
app.set("io", io);

// Root route
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Campus Exchange API is running",
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    application: "Campus Exchange",
  });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/listings", listingRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();

    const PORT = Number(process.env.PORT) || 5001;

    httpServer.listen(PORT, () => {
      console.log(`Campus Exchange API running on port ${PORT}`);
      console.log("Socket.IO server initialized");
    });
  } catch (error) {
    console.error("Failed to start Campus Exchange API:", error.message);
    process.exit(1);
  }
};

startServer();
