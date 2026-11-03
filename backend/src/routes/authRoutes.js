import express from "express";

import {
  register,
  login,
  changePassword,
} from "../controllers/authController.js";

import authMiddleware from "../middleware/authMiddleware.js";
import apiKeyMiddleware from "../middleware/apiKeyMiddleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);

router.get("/me", authMiddleware, (req, res) => {
  res.status(200).json({
    message: "Profile fetched successfully",
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

router.post("/change-password", authMiddleware, changePassword);

router.get("/secure-data", apiKeyMiddleware, (req, res) => {
  res.status(200).json({
    message: "API key verified successfully",
    data: "Welcome to Campus Exchange secure API",
  });
});

export default router;