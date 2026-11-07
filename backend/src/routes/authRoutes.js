import express from "express";

import {
  register,
  login,
  verifyEmailOtp,
  forgotPassword,
  resetPassword,
  changePassword,
} from "../controllers/authController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Registration
router.post("/register", register);

// Email verification
router.post("/verify-email-otp", verifyEmailOtp);

// Login
router.post("/login", login);

// Student password recovery
router.post("/forgot-password", (req, res, next) => {
  req.resetRole = "student";
  next();
}, forgotPassword);

router.post("/reset-password", (req, res, next) => {
  req.resetRole = "student";
  next();
}, resetPassword);

// Admin password recovery
router.post("/admin/forgot-password", (req, res, next) => {
  req.resetRole = "admin";
  next();
}, forgotPassword);

router.post("/admin/reset-password", (req, res, next) => {
  req.resetRole = "admin";
  next();
}, resetPassword);

// Change password (requires login)
router.put("/change-password", protect, changePassword);

export default router;