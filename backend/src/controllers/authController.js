import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { z } from "zod";
import nodemailer from "nodemailer";
import crypto from "crypto";

// ========================================
// GENERATE JWT TOKEN
// ========================================

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

// ========================================
// OTP CONFIGURATION
// ========================================

const OTP_EXPIRY = 10 * 60 * 1000;

const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

const hashOtp = (otp) => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

// ========================================
// SEND OTP EMAIL
// ========================================

const sendOtpEmail = async (email, otp, purpose) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is missing");
  }

  const isVerification = purpose === "verify";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "onboarding@resend.dev",
      to: [email],
      subject: isVerification
        ? "Campus Exchange - Email Verification"
        : "Campus Exchange - Password Reset",
      text: `Your OTP is ${otp}. It expires in 10 minutes.`,
      html: `
        <div style="font-family:Arial;padding:20px">
          <h2>Campus Exchange</h2>
          <p>Your ${
            isVerification ? "email verification" : "password reset"
          } code is:</p>
          <h1 style="letter-spacing:5px">${otp}</h1>
          <p>This OTP expires in 10 minutes.</p>
          <p>If you did not request this code, ignore this email.</p>
        </div>
      `,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("Resend API error:", result);
    throw new Error(result.message || "Failed to send OTP email");
  }

  console.log("OTP email sent successfully:", result.id);
};
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP configuration is missing in .env");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const isVerification = purpose === "verify";

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || SMTP_USER,
    to: email,

    subject: isVerification
      ? "Campus Exchange - Email Verification"
      : "Campus Exchange - Password Reset",

    text: `Your OTP is ${otp}. It expires in 10 minutes.`,

    html: `
      <div style="font-family:Arial;padding:20px">
        <h2>Campus Exchange</h2>

        <p>
          Your ${
            isVerification
              ? "email verification"
              : "password reset"
          } code is:
        </p>

        <h1 style="letter-spacing:5px">${otp}</h1>

        <p>This OTP expires in 10 minutes.</p>

        <p>
          If you did not request this code, ignore this email.
        </p>
      </div>
    `,
  });
};

// ========================================
// COMMON LOGIN RESPONSE
// ========================================

const sendLoginResponse = (user, res, message) => {
  const token = generateToken(user);

  return res.status(200).json({
    message,
    token,

    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
};

// ========================================
// REGISTER USER
// ========================================

export const register = async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2).max(60),
      email: z.string().trim().email(),
      password: z.string().min(8).max(72),
    });

    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validation.error.issues,
      });
    }

    const { name, email, password } = validation.data;
    const normalizedEmail = email.toLowerCase();

    let user = await User.findOne({
      email: normalizedEmail,
    });

    if (user && user.isEmailVerified) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const otp = generateOtp();

    if (user) {
      user.name = name;
      user.password = password;
      user.isEmailVerified = false;
      user.emailOtpHash = hashOtp(otp);
      user.emailOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY);

      await user.save();
    } else {
      user = await User.create({
        name,
        email: normalizedEmail,
        password,
        isEmailVerified: false,
        emailOtpHash: hashOtp(otp),
        emailOtpExpiresAt: new Date(Date.now() + OTP_EXPIRY),
      });
    }

    await sendOtpEmail(normalizedEmail, otp, "verify");

    return res.status(201).json({
      message: "OTP sent successfully. Verify your email.",
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      message: "Registration failed",
    });
  }
};

// ========================================
// VERIFY EMAIL OTP
// ========================================

export const verifyEmailOtp = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().email(),
      otp: z.string().regex(/^\d{6}$/),
    });

    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Enter a valid email and 6-digit OTP",
      });
    }

    const { email, otp } = validation.data;

    const user = await User.findOne({
      email: email.toLowerCase(),
    }).select("+emailOtpHash +emailOtpExpiresAt");

    if (
      !user ||
      user.isEmailVerified ||
      !user.emailOtpHash ||
      !user.emailOtpExpiresAt ||
      user.emailOtpExpiresAt < new Date() ||
      user.emailOtpHash !== hashOtp(otp)
    ) {
      return res.status(400).json({
        message: "Invalid or expired OTP",
      });
    }

    user.isEmailVerified = true;
    user.emailOtpHash = undefined;
    user.emailOtpExpiresAt = undefined;

    await user.save();

    return sendLoginResponse(
      user,
      res,
      "Email verified successfully"
    );
  } catch (error) {
    console.error("OTP verification error:", error);

    return res.status(500).json({
      message: "Email verification failed",
    });
  }
};

// ========================================
// LOGIN USER
// ========================================

export const login = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().email(),
      password: z.string().min(1),
    });

    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Validation failed",
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

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: "Please verify your email before logging in",
      });
    }

    return sendLoginResponse(
      user,
      res,
      "Login successful"
    );
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Login failed",
    });
  }
};

// ========================================
// FORGOT PASSWORD
// ========================================

export const forgotPassword = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().email(),
    });

    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Enter a valid email",
      });
    }

    const email = validation.data.email.toLowerCase();
    const requestedRole = req.resetRole || "student";

    // Find a verified account matching the requested role.
    const user = await User.findOne({
      email,
      isEmailVerified: true,
      role: requestedRole,
    });

    console.log("Password reset request:", {
      email,
      requestedRole,
      userFound: Boolean(user),
      actualRole: user?.role,
      isEmailVerified: user?.isEmailVerified,
    });

    if (user) {
      const otp = generateOtp();

      user.resetOtpHash = hashOtp(otp);
      user.resetOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY);

      await user.save();

      await sendOtpEmail(email, otp, "reset");

      console.log(
        "Password reset OTP email sent successfully to:",
        email
      );
    }

    return res.status(200).json({
      message: "If the account exists, a password reset OTP has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    return res.status(500).json({
      message: "Forgot password request failed",
    });
  }
};

// ========================================
// RESET PASSWORD
// ========================================

export const resetPassword = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().email(),
      otp: z.string().regex(/^\d{6}$/),
      newPassword: z.string().min(8).max(72),
    });

    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Invalid input",
      });
    }

    const { email, otp, newPassword } = validation.data;
    const requestedRole = req.resetRole || "student";

    const user = await User.findOne({
      email: email.toLowerCase(),
      isEmailVerified: true,
      role: requestedRole,
    }).select("+resetOtpHash +resetOtpExpiresAt +password");

    if (
      !user ||
      !user.resetOtpHash ||
      !user.resetOtpExpiresAt ||
      user.resetOtpExpiresAt < new Date() ||
      user.resetOtpHash !== hashOtp(otp)
    ) {
      return res.status(400).json({
        message: "Invalid or expired reset OTP",
      });
    }

    user.password = newPassword;
    user.resetOtpHash = undefined;
    user.resetOtpExpiresAt = undefined;

    await user.save();

    return res.status(200).json({
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      message: "Password reset failed",
    });
  }
};

// ========================================
// CHANGE PASSWORD
// ========================================

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

    const user = await User.findById(req.user._id)
      .select("+password");

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
