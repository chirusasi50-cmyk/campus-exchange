import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { z } from "zod";

// Generate JWT token
const generateToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing in .env");
  }

  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    }
  );
};

// REGISTER USER
export const register = async (req, res) => {
  try {
    const registerSchema = z.object({
      name: z.string().trim().min(2).max(60),
      email: z.string().trim().email("Enter a valid email address"),
      password: z.string().min(8).max(72),
    });

    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { name, email, password } = validation.data;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
    });

    const token = generateToken(user);

    return res.status(201).json({
      message: "Registration successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Registration failed",
    });
  }
};

// LOGIN USER
export const login = async (req, res) => {
  try {
    const loginSchema = z.object({
      email: z.string().trim().email("Enter a valid email address"),
      password: z.string().min(1, "Password is required"),
    });

    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { email, password } = validation.data;

    const user = await User.findOne({
      email: email.toLowerCase(),
    }).select("+password");

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Login failed",
    });
  }
};

// CHANGE PASSWORD
export const changePassword = async (req, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(72),
    });

    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Please provide valid password details",
      });
    }

    const { currentPassword, newPassword } = validation.data;

    if (currentPassword === newPassword) {
      return res.status(400).json({
        message: "New password must be different",
      });
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({
        message: "Current password is incorrect",
      });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      message: "Password changed successfully",
    });

  } catch (error) {
    console.error("Change password error:", error);

    return res.status(500).json({
      message: "Unable to change password",
    });
  }
};