import express from "express";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";

const app = express();
app.set("trust proxy", 1);

// CORS configuration
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5174",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
}));

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

    app.listen(PORT, () => {
      console.log(`Campus Exchange API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start Campus Exchange API:", error.message);
    process.exit(1);
  }
};

startServer();
