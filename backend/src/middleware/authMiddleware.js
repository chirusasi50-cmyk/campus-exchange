import jwt from "jsonwebtoken";
import User from "../models/User.js";

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Access denied. Please login first.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "Server authentication configuration error",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "Access denied. Token is missing.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    req.user = user;
    return next();

  } catch (error) {
    if (
      error.name === "TokenExpiredError" ||
      error.name === "JsonWebTokenError"
    ) {
      return res.status(401).json({
        message: "Invalid or expired token",
      });
    }

    console.error("Authentication middleware error:", error);

    return res.status(500).json({
      message: "Authentication failed due to a server error",
    });
  }
};

export default authMiddleware;