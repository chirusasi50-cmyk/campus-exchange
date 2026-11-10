import React, { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom";
import "./App.css";
import { io } from "socket.io-client";
import ProfileCardsDemo from "./ProfileCardsDemo.jsx";
const checkPasswordStrength = (password) => {
  const hasLetters = /[A-Za-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const isStrong = password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && hasNumbers
    && /[^A-Za-z0-9]/.test(password);

  if (isStrong) return { level: "strong", score: 3, label: "Strong password" };
  if (password.length >= 8 && hasLetters && hasNumbers) {
    return { level: "medium", score: 2, label: "Medium password" };
  }
  return { level: "weak", score: 1, label: "Weak password" };
};

const STUDENT_AUTH_KEY = "campusExchangeStudentDemo";
const ADMIN_AUTH_KEY = "campusExchangeAdminDemo";
const LISTINGS_KEY = "campusExchangeAdminListings";
const PROFILE_KEY = "campusExchangeStudentProfile";
const BLOCKS = ["A", "H", "N", "U", "P"];
const CATEGORIES = ["Books", "Electronics", "Accessories", "Other"];
const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:5001").replace(/\/+$/, "").replace(/\/api$/i, "");
const API_BASE_URL = `${API_ORIGIN}/api`;
const MAX_CHAT_FILE_SIZE = 10 * 1024 * 1024;
const CHAT_FILE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

async function apiFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach the backend at ${API_BASE_URL}. Check that it is running and allows this page origin (${window.location.origin}).`);
    }
    throw error;
  }
}

function currentToken() {
  return sessionStorage.getItem("adminToken") || sessionStorage.getItem("campusExchangeToken");
}

function normalizeId(value) {
  if (value === null || value === undefined) return "";
  const id = typeof value === "object" && value !== null && "_id" in value
    ? value._id
    : value;
  return id === null || id === undefined ? "" : String(id);
}

function upsertMessage(messages, nextMessage) {
  const nextId = normalizeId(nextMessage?._id);
  const index = messages.findIndex((message) => normalizeId(message._id) === nextId);
  if (index === -1) return [...messages, nextMessage];
  const updated = [...messages];
  updated[index] = nextMessage;
  return updated;
}

function mergeMessageLists(serverMessages, currentMessages) {
  const merged = new Map((serverMessages || []).map((message) => [normalizeId(message._id), message]));
  currentMessages.forEach((current) => {
    const id = normalizeId(current._id);
    const server = merged.get(id);
    if (!server) {
      merged.set(id, current);
      return;
    }
    const currentEditTime = current.editedAt ? new Date(current.editedAt).getTime() : 0;
    const serverEditTime = server.editedAt ? new Date(server.editedAt).getTime() : 0;
    const deletedAt = server.deletedAt || current.deletedAt;
    merged.set(id, {
      ...server,
      text: deletedAt ? "This message was deleted" : currentEditTime > serverEditTime ? current.text : server.text,
      editedAt: currentEditTime > serverEditTime ? current.editedAt : server.editedAt,
      deletedAt,
      deliveredAt: server.deliveredAt || current.deliveredAt,
      readAt: server.readAt || current.readAt,
    });
  });
  return [...merged.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function chatRequest(path, options = {}) {
  const token = currentToken();
  const response = await apiFetch(`${API_BASE_URL}/chat${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Chat request failed (${response.status}).`);
  return data;
}

function uploadChatFile(conversationId, file, text, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("text", text);
    form.append("file", file, file.name);
    xhr.open("POST", `${API_BASE_URL}/chat/conversations/${conversationId}/attachments`);
    const token = currentToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { /* keep a useful fallback */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      return reject(new Error(data.message || `Upload failed (${xhr.status}).`));
    });
    xhr.addEventListener("error", () => reject(new Error(`Cannot upload to ${API_BASE_URL}. Check the backend and CORS settings.`)));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.send(form);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentContentUrl(attachment) {
  return `${API_ORIGIN}${attachment.url}`;
}

async function downloadChatAttachment(attachment) {
  const response = await apiFetch(`${attachmentContentUrl(attachment)}?download=1`, {
    headers: { Authorization: `Bearer ${currentToken()}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Unable to download this attachment.");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = attachment.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function listingRequest(path, options = {}) {
  const isAdmin = sessionStorage.getItem(ADMIN_AUTH_KEY) === "true";
  const token = isAdmin
    ? sessionStorage.getItem("adminToken")
    : sessionStorage.getItem("campusExchangeToken");
  const response = await apiFetch(`${API_BASE_URL}/listings${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Unable to complete listing request.");
  return data;
}

function normalizeListing(listing) {
  const owner = typeof listing.owner === "string"
    ? { _id: listing.owner }
    : listing.owner;
  return {
    ...listing,
    owner,
    id: listing._id || listing.id,
    seller: listing.seller || owner?.name || "Student Seller",
    createdAt: listing.createdAt || "",
  };
}

async function fetchListings() {
  const data = await listingRequest("/");
  return (data.listings || []).map(normalizeListing);
}

function listingPayload(product) {
  return JSON.stringify({
    title: product.title,
    category: product.category,
    price: Number(product.price),
    condition: product.condition,
    description: product.description || "",
    contact: product.contact || "",
    emoji: product.emoji || EMOJIS[product.category] || "📦",
    block: product.block || "Unassigned",
    image: product.image || "",
  });
}

const EMOJIS = {
  Books: "📚",
  Electronics: "🎧",
  Accessories: "🎒",
  Other: "📦",
};

const INITIAL_PRODUCTS = [
  {
    id: 1,
    title: "Engineering Mathematics Textbook",
    category: "Books",
    price: 250,
    condition: "Good",
    seller: "Rahul K.",
    contact: "",
    description: "Useful for engineering mathematics preparation.",
    emoji: "📚",
    block: "Unassigned",
  },
  {
    id: 2,
    title: "Scientific Calculator",
    category: "Electronics",
    price: 450,
    condition: "Like New",
    seller: "Priya S.",
    contact: "",
    description: "Scientific calculator in excellent condition.",
    emoji: "🧮",
    block: "Unassigned",
  },
  {
    id: 3,
    title: "College Backpack",
    category: "Accessories",
    price: 350,
    condition: "Good",
    seller: "Kiran M.",
    contact: "",
    description: "Spacious backpack suitable for college.",
    emoji: "🎒",
    block: "Unassigned",
  },
  {
    id: 4,
    title: "Wireless Headphones",
    category: "Electronics",
    price: 700,
    condition: "Like New",
    seller: "Sneha R.",
    contact: "",
    description: "Comfortable headphones with clear audio.",
    emoji: "🎧",
    block: "Unassigned",
  },
  {
    id: 5,
    title: "Programming in C Textbook",
    category: "Books",
    price: 180,
    condition: "Good",
    seller: "Arjun P.",
    contact: "",
    description: "Helpful textbook for programming students.",
    emoji: "📖",
    block: "Unassigned",
  },
  {
    id: 6,
    title: "Desk Study Lamp",
    category: "Accessories",
    price: 220,
    condition: "Good",
    seller: "Divya N.",
    contact: "",
    description: "Study lamp suitable for hostel rooms.",
    emoji: "💡",
    block: "Unassigned",
  },
];

// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================

function readProducts() {
  try {
    const value = localStorage.getItem(LISTINGS_KEY);

    if (value !== null) {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    console.error("Unable to read listings:", error);
  }

  return INITIAL_PRODUCTS;
}

function saveProducts(items) {
  try {
    localStorage.setItem(LISTINGS_KEY, JSON.stringify(items));
    return true;
  } catch (error) {
    console.error("Unable to save listings:", error);
    alert("Unable to save. Try using a smaller image.");
    return false;
  }
}

function readProfile() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(PROFILE_KEY) || "{}"
    );

    return {
      name: saved.name || "",
      email:
        saved.email ||
        sessionStorage.getItem("campusExchangeStudentEmail") ||
        "",
      phone: saved.phone || "",
      course: saved.course || "B.Tech",
      year: saved.year || "3rd Year",
      bio: saved.bio || "",
      image: saved.image || "",
    };
  } catch {
    return {
      name: "",
      email:
        sessionStorage.getItem("campusExchangeStudentEmail") || "",
      phone: "",
      course: "B.Tech",
      year: "3rd Year",
      bio: "",
      image: "",
    };
  }
}

function readImageFile(file, success, failure) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    failure("Please select a JPG, PNG, or WEBP image.");
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    failure("Please select an image smaller than 2 MB.");
    return;
  }

  const reader = new FileReader();

  reader.onload = () => success(reader.result);
  reader.onerror = () => failure("Unable to read the selected image.");

  reader.readAsDataURL(file);
}

// ============================================================
// ROUTE PROTECTION
// ============================================================

function ProtectedStudentRoute({ children }) {
  return sessionStorage.getItem(STUDENT_AUTH_KEY) === "true" ? (
    children
  ) : (
    <Navigate to="/login" replace />
  );
}

function ProtectedAdminRoute({ children }) {
  return sessionStorage.getItem(ADMIN_AUTH_KEY) === "true" ? (
    children
  ) : (
    <Navigate to="/admin/login" replace />
  );
}

// The marketplace can be opened by either a logged-in student or an admin.
function ProtectedMarketplaceRoute({ children }) {
  const isStudent = sessionStorage.getItem(STUDENT_AUTH_KEY) === "true";
  const isAdmin = sessionStorage.getItem(ADMIN_AUTH_KEY) === "true";

  return isStudent || isAdmin ? (
    children
  ) : (
    <Navigate to="/login" replace />
  );
}

// ============================================================
// HEADER
// ============================================================

function Header() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(readProfile);

  useEffect(() => {
    const refresh = () => {
      setProfile(readProfile());
    };

    window.addEventListener("focus", refresh);
    window.addEventListener("campusProfileUpdated", refresh);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("campusProfileUpdated", refresh);
    };
  }, []);

  const displayName =
    profile.name || profile.email?.split("@")[0] || "Student";

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((character) => character[0].toUpperCase())
      .join("") || "S";

  return (
    <header className="site-header">
      <Link to="/welcome" className="brand">
        <span className="brand-icon">C</span>

        <span>
          <strong>Campus Exchange</strong>
          <small>Vignan University</small>
        </span>
      </Link>

      <nav className="header-navigation">
        <Link to="/welcome" className="nav-link">
          Home
        </Link>

        <Link to="/marketplace" className="nav-link">
          Marketplace
        </Link>

        <Link to="/messages" className="nav-link">
          Messages
        </Link>

        <Link to="/campus-blocks" className="nav-link">
          Campus Blocks
        </Link>

        <button
          type="button"
          className="profile-header-button"
          onClick={() => navigate("/profile")}
          aria-label="Open profile"
          title="My Profile"
        >
          {profile.image ? (
            <img
              src={profile.image}
              alt="Profile"
              className="header-profile-image"
            />
          ) : (
            <span className="header-profile-initials">{initials}</span>
          )}
        </button>
      </nav>
    </header>
  );
}

function StudentLogin() {
  const navigate = useNavigate();

  const [mode, setMode] = useState("login");
  const [stage, setStage] = useState("auth");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";
  const passwordStrength = password ? checkPasswordStrength(password) : null;

  function switchMode(nextMode) {
    setMode(nextMode);
    setStage("auth");
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
    setOtp("");
  }

  // API request helper
  async function authRequest(endpoint, payload) {
    const response = await apiFetch(
      `${API_BASE_URL}/auth/${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message || `Request failed (${response.status}).`
      );
    }

    return data;
  }

  // Store authentication information after successful login
  function completeLogin(data) {
    if (!data.token || !data.user) {
      throw new Error(
        "Authentication response is missing the token or user details."
      );
    }

    // Keep student and admin sessions separate in this browser tab.
    sessionStorage.removeItem(ADMIN_AUTH_KEY);
    sessionStorage.removeItem("adminToken");
    sessionStorage.setItem("campusExchangeToken", data.token);

    sessionStorage.setItem(STUDENT_AUTH_KEY, "true");

    sessionStorage.setItem(
      "campusExchangeStudentEmail",
      data.user.email
    );

    sessionStorage.setItem(
      "campusExchangeStudentId",
      data.user.id || data.user._id || ""
    );

    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        ...readProfile(),
        name: data.user.name,
        email: data.user.email,
      })
    );

    navigate("/welcome", { replace: true });
  }

  // Form submission
  async function submit(event) {
    event.preventDefault();

    setError("");
    setNotice("");

    try {
      setLoading(true);

      // STEP 1: VERIFY EMAIL OTP
      if (stage === "verify") {
        if (!/^\d{6}$/.test(otp.trim())) {
          throw new Error("Enter the 6-digit verification OTP.");
        }

        const data = await authRequest(
          "verify-email-otp",
          {
            email: email.trim(),
            otp: otp.trim(),
          }
        );

        completeLogin(data);
        return;
      }

      // STEP 2: FORGOT PASSWORD
      if (stage === "forgot") {
        await authRequest(
          "forgot-password",
          {
            email: email.trim(),
          }
        );

        setStage("reset");

        setNotice(
          "If an account exists for this email, a password reset OTP has been sent."
        );

        return;
      }

      // STEP 3: RESET PASSWORD
      if (stage === "reset") {
        if (!/^\d{6}$/.test(otp.trim())) {
          throw new Error("Enter the 6-digit password reset OTP.");
        }

        if (password.length < 8) {
          throw new Error(
            "New password must contain at least 8 characters."
          );
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        await authRequest(
          "reset-password",
          {
            email: email.trim(),
            otp: otp.trim(),
            newPassword: password,
          }
        );

        setStage("auth");
        setMode("login");
        setOtp("");
        setPassword("");
        setConfirmPassword("");

        setNotice(
          "Password reset successfully. Please log in with your new password."
        );

        return;
      }

      // STEP 4: REGISTER
      if (isRegister) {
        if (!name.trim()) {
          throw new Error("Please enter your full name.");
        }

        if (password.length < 8) {
          throw new Error(
            "Password must contain at least 8 characters."
          );
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        await authRequest(
          "register",
          {
            name: name.trim(),
            email: email.trim(),
            password,
          }
        );

        setStage("verify");
        setOtp("");

        setNotice(
          "A 6-digit verification code has been sent to your email."
        );

        return;
      }

      // STEP 5: LOGIN
      const data = await authRequest(
        "login",
        {
          email: email.trim(),
          password,
        }
      );

      completeLogin(data);

    } catch (err) {
      setError(
        err.message || "Unable to connect to the server."
      );
    } finally {
      setLoading(false);
    }
  }

  // Dynamic heading
  const heading =
    stage === "verify"
      ? "Verify Your Email"
      : stage === "forgot"
      ? "Forgot Password"
      : stage === "reset"
      ? "Reset Your Password"
      : isRegister
      ? "Create Account"
      : "Welcome 😊";

  const description =
    stage === "verify"
      ? `Enter the 6-digit code sent to ${email}.`
      : stage === "forgot"
      ? "Enter your registered email address to receive a reset code."
      : stage === "reset"
      ? "Enter the reset OTP and choose a new password."
      : isRegister
      ? "Create your account and join your campus community."
      : "Sign in to discover great deals and connect with students on your campus.";

  return (
    <main className="auth-page">

      <div className="auth-decoration auth-decoration-one" />
      <div className="auth-decoration auth-decoration-two" />

      <section className="auth-card">

        {/* BRAND */}
        <Link to="/login" className="auth-brand">

          <span className="brand-icon">C</span>

          <span>
            <strong>Campus Exchange</strong>
            <small>Vignan University Marketplace</small>
          </span>

        </Link>

        {/* LOGIN / REGISTER TOGGLE */}
        {stage === "auth" && (
          <div className="auth-mode-toggle">

            <button
              type="button"
              className={
                !isRegister
                  ? "auth-mode-button active"
                  : "auth-mode-button"
              }
              onClick={() => switchMode("login")}
            >
              Login
            </button>

            <button
              type="button"
              className={
                isRegister
                  ? "auth-mode-button active"
                  : "auth-mode-button"
              }
              onClick={() => switchMode("register")}
            >
              Register
            </button>

          </div>
        )}

        {/* HEADING */}
        <div className="auth-heading">

          <div className="auth-emoji">
            {stage === "verify"
              ? "✉️"
              : stage === "forgot" || stage === "reset"
              ? "🔐"
              : "🎓"}
          </div>

          <p className="eyebrow">
            YOUR CAMPUS, YOUR COMMUNITY
          </p>

          <h1>{heading}</h1>

          <p>{description}</p>

        </div>

        {/* FORM */}
        <form className="auth-form" onSubmit={submit}>

          {/* FULL NAME */}
          {stage === "auth" && isRegister && (
            <>
              <label htmlFor="student-name">
                Full Name
              </label>

              <input
                id="student-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                autoComplete="name"
                minLength={2}
                maxLength={60}
                required
              />
            </>
          )}

          {/* EMAIL */}
          <label htmlFor="student-email">
            Email Address
          </label>

          <input
            id="student-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            readOnly={stage === "verify" || stage === "reset"}
          />

          {/* OTP */}
          {(stage === "verify" || stage === "reset") && (
            <>
              <label htmlFor="student-otp">
                {stage === "verify"
                  ? "Email Verification OTP"
                  : "Password Reset OTP"}
              </label>

              <input
                id="student-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) =>
                  setOtp(
                    e.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                placeholder="Enter 6-digit OTP"
                maxLength={6}
                required
              />
            </>
          )}

          {/* PASSWORD */}
          {(stage === "auth" || stage === "reset") && (
            <>
              <label htmlFor="student-password">
                {stage === "reset"
                  ? "New Password"
                  : "Password"}
              </label>

              <div className="password-wrapper">

                <input
                  id="student-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    stage === "reset"
                      ? "Enter new password"
                      : isRegister
                      ? "Create a password"
                      : "Enter your password"
                  }
                  autoComplete={
                    stage === "reset" || isRegister
                      ? "new-password"
                      : "current-password"
                  }
                  minLength={
                    stage === "auth" && !isRegister
                      ? undefined
                      : 8
                  }
                  required
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() =>
                    setShowPassword((value) => !value)
                  }
                >
                  {showPassword ? "Hide" : "Show"}
                </button>

              </div>

              {isRegister && stage === "auth" && passwordStrength && (
                <div
                  className={`password-strength password-strength-${passwordStrength.level}`}
                  role="meter"
                  aria-label="Password strength"
                  aria-valuemin={1}
                  aria-valuemax={3}
                  aria-valuenow={passwordStrength.score}
                  aria-valuetext={passwordStrength.label}
                >
                  <div className="strength-track" aria-hidden="true">
                    <div
                      className="strength-fill"
                      style={{ width: `${(passwordStrength.score / 3) * 100}%` }}
                    />
                  </div>
                  <p className="strength-label" aria-live="polite">{passwordStrength.label}</p>
                </div>
              )}

              {/* CONFIRM PASSWORD */}
              {(isRegister || stage === "reset") && (
                <>
                  <label htmlFor="student-confirm-password">
                    Confirm Password
                  </label>

                  <div className="password-wrapper">

                    <input
                      id="student-confirm-password"
                      type={
                        showConfirmPassword
                          ? "text"
                          : "password"
                      }
                      value={confirmPassword}
                      onChange={(e) =>
                        setConfirmPassword(e.target.value)
                      }
                      placeholder="Re-enter your password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />

                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() =>
                        setShowConfirmPassword(
                          (value) => !value
                        )
                      }
                    >
                      {showConfirmPassword ? "Hide" : "Show"}
                    </button>

                  </div>
                </>
              )}
            </>
          )}

          {/* FORGOT PASSWORD LINK */}
{stage === "auth" && !isRegister && (
  <button
    type="button"
    className="forgot-password-link"
    onClick={() => {
      setStage("forgot");
      setError("");
      setNotice("");
    }}
  >
    Forgot password?
  </button>
)}

          {/* NOTICE */}
          {notice && (
            <p className="password-success" role="status">
              {notice}
            </p>
          )}

          {/* ERROR */}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {/* SUBMIT */}
          <button
            type="submit"
            className="button button-primary full-width"
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : stage === "verify"
              ? "Verify Email →"
              : stage === "forgot"
              ? "Send Reset OTP →"
              : stage === "reset"
              ? "Reset Password →"
              : isRegister
              ? "Create Account →"
              : "Login ←"}
          </button>

        </form>

        {/* BACK BUTTON */}
        {stage !== "auth" && (
          <p className="auth-footer">

            <button
              type="button"
              onClick={() => {
                setStage("auth");
                setMode("login");
                setError("");
                setNotice("");
                setOtp("");
              }}
            >
              ← Back to login
            </button>

          </p>
        )}

        {/* FOOTER */}
        {stage === "auth" && (
          <>
            <div className="auth-divider">
              <span>MADE FOR STUDENTS</span>
            </div>

            <div className="auth-features">
              <span>✓ Campus community</span>
              <span>✓ Student-friendly deals</span>
            </div>

            <p className="auth-footer">
              Administration access?{" "}
              <Link to="/admin/login">
                Admin login
              </Link>
            </p>
          </>
        )}

      </section>
    </main>
  );
}
// ============================================================
// STUDENT WELCOME PAGE
// ============================================================

function StudentWelcome() {
  const navigate = useNavigate();

  return (
    <div className="app-page">
      <Header />

      <main className="welcome-main">
        <section className="welcome-hero">
          <div className="welcome-copy">
            <div className="welcome-badge">
              <span className="badge-dot" />
              THE STUDENT MARKETPLACE
            </div>

            <h1>
              Your campus.
              <br />
              <span>Your marketplace.</span>
            </h1>

            <p className="welcome-description">
              Buy, sell, and exchange what you need with fellow students.
              Great finds, fair prices, and a community that understands
              student life.
            </p>

            <div className="welcome-actions">
              <button
                className="button button-primary"
                onClick={() =>
                  navigate("/marketplace?intent=sell")
                }
              >
                ＋ Sell an Item
              </button>

              <button
                className="button button-secondary"
                onClick={() => navigate("/marketplace")}
              >
                Browse Marketplace →
              </button>
            </div>

            <div className="welcome-trust">
              <span className="trust-icon">✓</span>
              <span>Made for students, by students.</span>
            </div>
          </div>

          <div className="welcome-visual">
            <div className="visual-glow" />

            <div className="visual-card-main">
              <div className="visual-card-top">
                <span className="visual-category">
                  STUDY ESSENTIALS
                </span>

                <span className="visual-heart">♡</span>
              </div>

              <div className="book-illustration">
                <div className="book book-green">CS</div>
                <div className="book book-cream">MATH</div>
                <div className="book book-orange">ENG</div>
              </div>

              <div className="visual-product-info">
                <div>
                  <strong>Study Materials</strong>
                  <p>Find your next favourite resource</p>
                </div>

                <span className="visual-arrow">↗</span>
              </div>
            </div>

            <div className="floating-card floating-card-top">
              <span className="floating-icon">♻️</span>

              <div>
                <strong>Give items a second life</strong>
                <small>Buy smart. Waste less.</small>
              </div>
            </div>

            <div className="floating-card floating-card-bottom">
              <div className="avatar-stack">
                <span>R</span>
                <span>P</span>
                <span>S</span>
              </div>

              <div>
                <strong>Your campus community</strong>
                <small>Connect with fellow students</small>
              </div>
            </div>

            <div className="visual-decoration visual-star">✳</div>
            <div className="visual-decoration visual-sparkle">✦</div>
          </div>
        </section>

        <section className="benefits-section">
          <div className="section-heading">
            <p className="eyebrow">A SMARTER WAY TO CAMPUS SHOP</p>

            <h2>Everything students need, in one place.</h2>
          </div>

          <div className="benefit-grid">
            <article className="benefit-card">
              <div className="benefit-icon benefit-green">🛍️</div>
              <h3>Buy for less</h3>
              <p>
                Find affordable books, gadgets, and essentials from
                fellow students.
              </p>
            </article>

            <article className="benefit-card">
              <div className="benefit-icon benefit-yellow">💰</div>
              <h3>Sell with ease</h3>
              <p>
                Give unused items a new home and earn money from things
                you no longer need.
              </p>
            </article>

            <article className="benefit-card">
              <div className="benefit-icon benefit-purple">🤝</div>
              <h3>Stay connected</h3>
              <p>
                Connect with people in your university community.
              </p>
            </article>
          </div>
        </section>

        <section className="welcome-bottom-cta">
          <div>
            <p className="eyebrow">READY TO GET STARTED?</p>

            <h2>Your next great find is waiting.</h2>

            <p>
              Explore the marketplace or list something of your own.
            </p>
          </div>

          <button
            className="button button-primary"
            onClick={() => navigate("/marketplace")}
          >
            Explore Marketplace →
          </button>
        </section>
      </main>

      <footer className="site-footer">
        <span>© 2026 Campus Exchange</span>
        <span>Built for the Vignan student community.</span>
      </footer>
    </div>
  );
}

// ============================================================
// STUDENT PROFILE PAGE
// ============================================================

function StudentProfile() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(readProfile);
  const [form, setForm] = useState(readProfile);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);

  async function submitPasswordChange(event) {
    event.preventDefault();
    setPasswordChangeError("");
    setPasswordChangeSuccess("");

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordChangeError("Fill in all three password fields.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordChangeError("Your new password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError("The new passwords do not match.");
      return;
    }

    const token = sessionStorage.getItem("adminToken") || sessionStorage.getItem("campusExchangeToken");
    if (!token) {
      setPasswordChangeError("Please log in again before changing your password.");
      return;
    }

    setPasswordChangeLoading(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/auth/change-password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to change your password.");

      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordChangeSuccess(data.message || "Password changed successfully.");
    } catch (requestError) {
      setPasswordChangeError(requestError.message || "Unable to change your password.");
    } finally {
      setPasswordChangeLoading(false);
    }
  }

  function change(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));

    setError("");
    setMessage("");
  }

  function imageChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    readImageFile(
      file,
      (image) => {
        setForm((previous) => ({
          ...previous,
          image,
        }));

        setError("");
      },
      setError
    );

    event.target.value = "";
  }

  function save(event) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (!form.email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (form.phone.trim()) {
      const digits = form.phone.replace(/\D/g, "");

      if (digits.length < 10 || digits.length > 15) {
        setError("Please enter a valid phone number.");
        return;
      }
    }

    const updated = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      course: form.course.trim(),
      bio: form.bio.trim(),
    };

    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));

      sessionStorage.setItem(
        "campusExchangeStudentEmail",
        updated.email
      );

      setProfile(updated);
      setForm(updated);
      setEditing(false);
      setError("");

      setMessage("Your profile has been updated successfully.");

      window.dispatchEvent(new Event("campusProfileUpdated"));
    } catch (error) {
      console.error("Unable to save profile:", error);

      setError(
        "Unable to save your profile. Try a smaller profile image."
      );
    }
  }

  function logout() {
    const confirmed = window.confirm(
      "Are you sure you want to log out?"
    );

    if (!confirmed) return;

    sessionStorage.removeItem(STUDENT_AUTH_KEY);
    sessionStorage.removeItem("campusExchangeStudentEmail");
    sessionStorage.removeItem("campusExchangeToken");
    sessionStorage.removeItem("campusExchangeStudentId");

    navigate("/login", { replace: true });
  }

  const name = profile.name || "Student";

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((character) => character[0].toUpperCase())
      .join("") || "S";

  return (
    <div className="app-page">
      <Header />

      <main className="student-profile-page">
        <div className="profile-page-heading">
          <div>
            <p className="eyebrow">YOUR ACCOUNT</p>
            <h1>My Profile</h1>
            <p>Manage your personal information and profile photo.</p>
          </div>

          <button
            className="button button-secondary"
            onClick={() => navigate("/welcome")}
          >
            ← Back to Home
          </button>
        </div>

        <section className="student-profile-card">
          <div className="student-profile-banner">
            <span className="profile-banner-decoration">✦</span>
            <span className="profile-banner-decoration second">✳</span>
          </div>

          <div className="profile-card-content">
            <div className="profile-photo-section">
              <div className="profile-photo-wrapper">
                {profile.image ? (
                  <img
                    src={profile.image}
                    alt={`${name}'s profile`}
                    className="profile-large-image"
                  />
                ) : (
                  <div className="profile-large-placeholder">
                    {initials}
                  </div>
                )}
              </div>

              {editing && (
                <div className="profile-photo-actions">
                  <label
                    className="profile-photo-upload"
                    htmlFor="profile-image-input"
                  >
                    📷 Change photo

                    <input
                      id="profile-image-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={imageChange}
                      hidden
                    />
                  </label>

                  {form.image && (
                    <button
                      type="button"
                      className="profile-remove-photo"
                      onClick={() =>
                        setForm((previous) => ({
                          ...previous,
                          image: "",
                        }))
                      }
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="profile-identity">
              <h2>{name}</h2>

              <p>{profile.email || "Add your email address"}</p>

              <span className="profile-student-badge">
                🎓 Student Account
              </span>
            </div>

            {!editing && (
              <button
                className="button button-primary profile-edit-button"
                onClick={() => {
                  setForm(profile);
                  setEditing(true);
                  setError("");
                  setMessage("");
                }}
              >
                ✏️ Edit Profile
              </button>
            )}
          </div>

          <div className="profile-details-section">
            <div className="profile-section-heading">
              <h3>Personal Information</h3>

              <p>
                {editing
                  ? "Update your details below."
                  : "Your student profile details."}
              </p>
            </div>

            {message && (
              <div className="profile-success-message" role="status">
                ✓ {message}
              </div>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            {editing ? (
              <form className="profile-edit-form" onSubmit={save}>
                <div className="profile-form-grid">
                  <div className="profile-form-field">
                    <label htmlFor="profile-name">Full Name *</label>

                    <input
                      id="profile-name"
                      name="name"
                      value={form.name}
                      onChange={change}
                      placeholder="Enter your full name"
                      required
                    />
                  </div>

                  <div className="profile-form-field">
                    <label htmlFor="profile-email">
                      Email Address *
                    </label>

                    <input
                      id="profile-email"
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={change}
                      placeholder="you@example.com"
                      required
                    />
                  </div>

                  <div className="profile-form-field">
                    <label htmlFor="profile-phone">Phone Number</label>

                    <input
                      id="profile-phone"
                      name="phone"
                      type="tel"
                      value={form.phone}
                      onChange={change}
                      placeholder="Enter your phone number"
                    />
                  </div>

                  <div className="profile-form-field">
                    <label htmlFor="profile-course">Course</label>

                    <input
                      id="profile-course"
                      name="course"
                      value={form.course}
                      onChange={change}
                      placeholder="e.g. B.Tech CSE"
                    />
                  </div>

                  <div className="profile-form-field">
                    <label htmlFor="profile-year">Academic Year</label>

                    <select
                      id="profile-year"
                      name="year"
                      value={form.year}
                      onChange={change}
                    >
                      <option>1st Year</option>
                      <option>2nd Year</option>
                      <option>3rd Year</option>
                      <option>4th Year</option>
                      <option>Graduated</option>
                    </select>
                  </div>

                  <div className="profile-form-field profile-bio-field">
                    <label htmlFor="profile-bio">About Me</label>

                    <textarea
                      id="profile-bio"
                      name="bio"
                      value={form.bio}
                      onChange={change}
                      placeholder="Tell fellow students about yourself..."
                      rows="4"
                      maxLength={300}
                    />

                    <small>{form.bio.length}/300 characters</small>
                  </div>
                </div>

                <p className="profile-image-note">
                  Profile photo: JPG, PNG, or WEBP, maximum 2 MB.
                </p>

                <div className="profile-form-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setForm(profile);
                      setEditing(false);
                      setError("");
                      setMessage("");
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="button button-primary"
                  >
                    Save Changes →
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="profile-details-grid">
                  <div className="profile-detail-item">
                    <span className="profile-detail-icon">👤</span>

                    <div>
                      <small>Full Name</small>
                      <strong>{profile.name || "Not provided"}</strong>
                    </div>
                  </div>

                  <div className="profile-detail-item">
                    <span className="profile-detail-icon">✉️</span>

                    <div>
                      <small>Email Address</small>
                      <strong>{profile.email || "Not provided"}</strong>
                    </div>
                  </div>

                  <div className="profile-detail-item">
                    <span className="profile-detail-icon">📱</span>

                    <div>
                      <small>Phone Number</small>
                      <strong>{profile.phone || "Not provided"}</strong>
                    </div>
                  </div>

                  <div className="profile-detail-item">
                    <span className="profile-detail-icon">🎓</span>

                    <div>
                      <small>Course</small>
                      <strong>{profile.course || "Not provided"}</strong>
                    </div>
                  </div>

                  <div className="profile-detail-item">
                    <span className="profile-detail-icon">📅</span>

                    <div>
                      <small>Academic Year</small>
                      <strong>{profile.year || "Not provided"}</strong>
                    </div>
                  </div>

                  <div className="profile-detail-item profile-about-item">
                    <span className="profile-detail-icon">💬</span>

                    <div>
                      <small>About Me</small>
                      <strong>
                        {profile.bio || "No bio added yet."}
                      </strong>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* CHANGE PASSWORD SECTION */}
<section className="change-password-section">
  <div className="change-password-heading">
    <div className="password-icon">🔐</div>
    <div>
      <h3>Change Password</h3>
      <p>
        Keep your Campus Exchange account secure by updating your password.
      </p>
    </div>
  </div>

  <form
    className="change-password-form"
    onSubmit={submitPasswordChange}
  >
    <div className="password-field">
      <label htmlFor="current-password">Current Password</label>
      <input
        id="current-password"
        type="password"
        value={currentPassword}
        onChange={(event) => {
          setCurrentPassword(event.target.value);
          setPasswordChangeError("");
          setPasswordChangeSuccess("");
        }}
        placeholder="Enter current password"
        autoComplete="current-password"
        required
      />
    </div>

    <div className="password-field">
      <label htmlFor="new-password">New Password</label>
      <input
        id="new-password"
        type="password"
        value={newPassword}
        onChange={(event) => {
          setNewPassword(event.target.value);
          setPasswordChangeError("");
          setPasswordChangeSuccess("");
        }}
        placeholder="Enter new password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <small>Use at least 8 characters.</small>
    </div>

    <div className="password-field">
      <label htmlFor="confirm-password">Confirm New Password</label>
      <input
        id="confirm-password"
        type="password"
        value={confirmNewPassword}
        onChange={(event) => {
          setConfirmNewPassword(event.target.value);
          setPasswordChangeError("");
          setPasswordChangeSuccess("");
        }}
        placeholder="Confirm new password"
        autoComplete="new-password"
        minLength={8}
        required
      />
    </div>

    {passwordChangeSuccess && <p className="password-success change-password-feedback" role="status">{passwordChangeSuccess}</p>}
    {passwordChangeError && <p className="form-error change-password-feedback" role="alert">{passwordChangeError}</p>}

    <button type="submit" className="button button-primary" disabled={passwordChangeLoading}>
      {passwordChangeLoading ? "Updating…" : "🔒 Update Password"}
    </button>
  </form>
</section>
          <div className="profile-logout-section">
            <div>
              <h3>Sign out</h3>

              <p>
                Log out of your Campus Exchange student account on this
                browser.
              </p>
            </div>

            <button
              type="button"
              className="button button-danger"
              onClick={logout}
            >
              ↪ Log out
            </button>
          </div>
        </section>

        <p className="profile-storage-note">
          Demo app: profile details and photo are saved in this browser
          only.
        </p>
      </main>

      <footer className="site-footer">
        <span>© 2026 Campus Exchange</span>
        <span>Vignan University</span>
      </footer>
    </div>
  );
}


// ============================================================
// PRODUCT CARD
// ============================================================

function ProductCard({ product, onEdit, onDelete, onChat }) {
  return (
    <article className="product-card">
      <div className="product-image">
        <span className="product-category-tag">
          {product.category}
        </span>

        {product.image ? (
          <img
            src={product.image}
            alt={product.title}
            className="product-card-image"
          />
        ) : (
          <span className="product-emoji">
            {product.emoji || "📦"}
          </span>
        )}
      </div>

      <div className="product-content">
        <div className="product-condition">{product.condition}</div>

        {product.block && product.block !== "Unassigned" && (
          <span className="product-block-label">
            📍 {product.block} Block
          </span>
        )}

        <h3>{product.title}</h3>

        <p className="product-description">
          {product.description || "A useful item for campus life."}
        </p>

        <div className="product-price-row">
          <strong className="product-price">
            ₹{Number(product.price).toLocaleString("en-IN")}
          </strong>

          <span className="product-location">📍 Campus</span>
        </div>

        <div className="product-seller">
          <span className="seller-avatar">
            {(product.seller || "S").charAt(0).toUpperCase()}
          </span>

          <span>{product.seller || "Student Seller"}</span>
        </div>

        <button
          type="button"
          className="button button-secondary product-contact"
          onClick={() => onChat?.(product)}
          disabled={!onChat}
        >
          {onChat ? "Let's Chat" : product.owner?._id === sessionStorage.getItem("campusExchangeStudentId") ? "Your Listing" : "Chat unavailable"}
        </button>

        {(onEdit || onDelete) && (
          <div className="product-management-actions">
            {onEdit && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => onEdit(product)}
              >
                ✏️ Edit
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                className="button button-danger"
                onClick={() => onDelete(product.id)}
              >
                🗑️ Delete
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function SecureAttachment({ attachment, onError }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const isImage = attachment.mimeType.startsWith("image/");
  const typeLabel = attachment.mimeType === "application/pdf"
    ? "PDF document"
    : `${attachment.mimeType.split("/")[1].toUpperCase()} image`;

  useEffect(() => {
    if (!isImage) return undefined;
    let active = true;
    let objectUrl = "";
    apiFetch(attachmentContentUrl(attachment), {
      headers: { Authorization: `Bearer ${currentToken()}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load this image preview.");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setPreviewUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch((error) => { if (active) setPreviewError(error.message); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment._id, attachment.url, isImage]);

  async function download() {
    try {
      await downloadChatAttachment(attachment);
    } catch (error) {
      onError(error.message || "Unable to download this attachment.");
    }
  }

  return (
    <div className="chat-attachment">
      {isImage ? (
        previewUrl ? <img className="chat-attachment-image" src={previewUrl} alt={attachment.filename} />
          : <div className="chat-attachment-image-loading">{previewError || "Loading image preview…"}</div>
      ) : <span className="chat-attachment-file-icon" aria-hidden="true">PDF</span>}
      <div className="chat-attachment-details">
        <strong title={attachment.filename}>{attachment.filename}</strong>
        <span>{typeLabel} · {formatFileSize(attachment.size)}</span>
      </div>
      <button type="button" className="chat-attachment-download" onClick={download} aria-label={`Download ${attachment.filename}`}>
        Download
      </button>
    </div>
  );
}

function chatDayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = (item) => `${item.getFullYear()}-${item.getMonth()}-${item.getDate()}`;
  if (key(date) === key(today)) return "Today";
  if (key(date) === key(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function ChatCenter() {
  const { conversationId: routeConversationId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeId, setActiveId] = useState(new URLSearchParams(location.search).get("conversation") || routeConversationId || "");
  const [draft, setDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const bottomRef = useRef(null);
  const messagesViewportRef = useRef(null);
  const messageElementsRef = useRef(new Map());
  const shouldAutoScrollRef = useRef(true);
  const initialMessageLoadRef = useRef(true);
  const fileInputRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingActiveRef = useRef(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const myId = sessionStorage.getItem("campusExchangeStudentId") || sessionStorage.getItem("campusExchangeAdminId") || "";
  const activeConversation = conversations.find((item) => item._id === activeId);

  async function refreshConversations() {
    const data = await chatRequest("/conversations");
    setConversations(data.conversations || []);
  }

  function applyReactions({ conversationId, messageId, reactions }) {
    if (normalizeId(conversationId) !== normalizeId(activeId)) return;
    setMessages((current) => current.map((message) => normalizeId(message._id) === normalizeId(messageId)
      ? { ...message, reactions: reactions || [] }
      : message));
  }

  useEffect(() => {
    let mounted = true;
    chatRequest("/conversations")
      .then((data) => { if (mounted) setConversations(data.conversations || []); })
      .catch((requestError) => { if (mounted) setError(requestError.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const requestedId = new URLSearchParams(location.search).get("conversation") || routeConversationId || "";
    setActiveId(requestedId);
  }, [location.search, routeConversationId]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return undefined; }
    let mounted = true;
    setMessages([]);
    setSearchResults(null);
    initialMessageLoadRef.current = true;
    setError("");
    setPeerOnline(false);
    setPeerTyping(false);
    typingActiveRef.current = false;
    const syncMessages = () => chatRequest(`/conversations/${activeId}/messages`)
      .then((data) => {
        if (!mounted) return;
        setMessages((current) => mergeMessageLists(data.messages, current));
        shouldAutoScrollRef.current = true;
        refreshConversations().catch(() => {});
      })
      .catch((requestError) => { if (mounted) setError(requestError.message); });
    syncMessages();
    const socket = io(API_ORIGIN, {
      auth: { token: currentToken() },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("conversation:join", activeId);
      syncMessages();
    });
    socket.on("disconnect", () => {
      setPeerOnline(false);
      setPeerTyping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
      typingActiveRef.current = false;
    });
    socket.on("presence:state", ({ conversationId, participants = [] }) => {
      if (normalizeId(conversationId) !== normalizeId(activeId)) return;
      const peer = participants.find((participant) => normalizeId(participant.userId) !== normalizeId(myId));
      setPeerOnline(Boolean(peer?.online));
    });
    socket.on("presence:update", ({ conversationId, userId, online }) => {
      if (normalizeId(conversationId) === normalizeId(activeId) && normalizeId(userId) !== normalizeId(myId)) {
        setPeerOnline(Boolean(online));
      }
    });
    socket.on("typing:update", ({ conversationId, userId, typing }) => {
      if (normalizeId(conversationId) === normalizeId(activeId) && normalizeId(userId) !== normalizeId(myId)) {
        setPeerTyping(Boolean(typing));
      }
    });
    socket.on("message:new", ({ conversationId, message }) => {
      if (normalizeId(conversationId) === normalizeId(activeId)) {
        const viewport = messagesViewportRef.current;
        shouldAutoScrollRef.current = !viewport || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 140;
        setMessages((current) => upsertMessage(current, message));
        if (normalizeId(message.sender) !== normalizeId(myId)) {
          socket.emit("messages:mark-read", { conversationId });
        }
      }
      refreshConversations().catch(() => {});
    });
    socket.on("message:updated", ({ conversationId, message }) => {
      if (normalizeId(conversationId) === normalizeId(activeId)) {
        setMessages((current) => upsertMessage(current, message));
      }
      refreshConversations().catch(() => {});
    });
    socket.on("message:reactions", applyReactions);
    socket.on("message:receipt", ({ conversationId, messageId, deliveredAt, readAt }) => {
      if (normalizeId(conversationId) !== normalizeId(activeId)) return;
      setMessages((current) => current.map((message) => normalizeId(message._id) === normalizeId(messageId)
        ? { ...message, deliveredAt: deliveredAt || message.deliveredAt, readAt: readAt || message.readAt }
        : message));
    });
    socket.on("messages:read", ({ conversationId, messageIds = [], readAt }) => {
      if (normalizeId(conversationId) !== normalizeId(activeId)) return;
      const readIdSet = new Set(messageIds.map(normalizeId));
      setMessages((current) => current.map((message) => readIdSet.has(normalizeId(message._id))
        ? { ...message, deliveredAt: message.deliveredAt || readAt, readAt: message.readAt || readAt }
        : message));
      refreshConversations().catch(() => {});
    });
    return () => {
      mounted = false;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (typingActiveRef.current) socket.emit("typing:set", { conversationId: activeId, typing: false });
      typingActiveRef.current = false;
      socket.emit("conversation:leave", activeId);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [activeId]);

  useEffect(() => {
    if (!messages.length) return;
    if (shouldAutoScrollRef.current) bottomRef.current?.scrollIntoView({ behavior: initialMessageLoadRef.current ? "auto" : "smooth" });
    initialMessageLoadRef.current = false;
    shouldAutoScrollRef.current = false;
  }, [messages]);

  useEffect(() => {
    if (!selectedFile || !selectedFile.type.startsWith("image/")) {
      setPreviewUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  async function send(event) {
    event.preventDefault();
    if (!activeId || (!draft.trim() && !selectedFile) || sending) return;
    stopTyping();
    setSending(true);
    setUploadProgress(selectedFile ? 0 : null);
    try {
      const data = selectedFile
        ? await uploadChatFile(activeId, selectedFile, draft, setUploadProgress)
        : await chatRequest(`/conversations/${activeId}/messages`, { method: "POST", body: JSON.stringify({ text: draft }) });
      shouldAutoScrollRef.current = true;
      setMessages((current) => upsertMessage(current, data.message));
      setDraft("");
      setSelectedFile(null);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshConversations();
    } catch (requestError) {
      setError(requestError.message);
      setUploadProgress(null);
    } finally {
      setSending(false);
    }
  }

  function selectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    const allowedExtensions = {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "application/pdf": [".pdf"],
    };
    if (!CHAT_FILE_TYPES.has(file.type) || !allowedExtensions[file.type]?.includes(extension)) {
      setSelectedFile(null);
      setError("Choose a valid JPG, PNG, WEBP, or PDF file.");
      return;
    }
    if (file.size > MAX_CHAT_FILE_SIZE) {
      setSelectedFile(null);
      setError("Attachments must be 10 MB or smaller.");
      return;
    }
    setError("");
    setSelectedFile(file);
    setUploadProgress(null);
  }

  async function editMessage(message) {
    const text = window.prompt("Edit your message", message.text);
    if (text === null || !text.trim()) return;
    try {
      const data = await chatRequest(`/conversations/${activeId}/messages/${message._id}`, { method: "PATCH", body: JSON.stringify({ text }) });
      setMessages((current) => upsertMessage(current, data.message));
    } catch (requestError) { setError(requestError.message); }
  }

  async function removeMessage(message) {
    if (!window.confirm("Delete this message?")) return;
    try {
      const data = await chatRequest(`/conversations/${activeId}/messages/${message._id}`, { method: "DELETE" });
      setMessages((current) => upsertMessage(current, data.message));
    } catch (requestError) { setError(requestError.message); }
  }

  async function searchConversation(event) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query || !activeId) return;
    setSearching(true);
    try {
      const data = await chatRequest(`/conversations/${activeId}/messages/search?q=${encodeURIComponent(query)}`);
      setSearchResults(data.messages || []);
    } catch (requestError) { setError(requestError.message); }
    finally { setSearching(false); }
  }

  async function reactToMessage(message, emoji) {
    setReactionPickerFor("");
    try {
      const data = await chatRequest(`/conversations/${activeId}/messages/${message._id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
      applyReactions(data);
    } catch (requestError) { setError(requestError.message); }
  }


  function jumpToMessage(message) {
    setSearchResults(null);
    setHighlightedMessageId(normalizeId(message._id));
    requestAnimationFrame(() => messageElementsRef.current.get(normalizeId(message._id))?.scrollIntoView({ behavior: "smooth", block: "center" }));
    window.setTimeout(() => setHighlightedMessageId(""), 1800);
  }

  function stopTyping(socket = socketRef.current, conversationId = activeId) {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    if (!typingActiveRef.current) return;
    socket?.emit("typing:set", { conversationId, typing: false });
    typingActiveRef.current = false;
  }

  function changeDraft(event) {
    const nextDraft = event.target.value;
    setDraft(nextDraft);
    const socket = socketRef.current;
    if (!nextDraft.trim() || !activeId || !socket?.connected) {
      stopTyping(socket, activeId);
      return;
    }
    if (!typingActiveRef.current) {
      socket.emit("typing:set", { conversationId: activeId, typing: true });
      typingActiveRef.current = true;
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => stopTyping(socket, activeId), 900);
  }

  function otherParticipant(conversation) {
    return conversation?.participants?.find((person) => normalizeId(person) !== normalizeId(myId)) || conversation?.participants?.[0];
  }

  const allowedReactions = ["👍", "❤️", "😂", "😮", "😢", "🎉"];
  return <div className="app-page"><Header /><main className="chat-page">
    <div className="chat-heading"><div><p className="eyebrow">CAMPUS EXCHANGE</p><h1>Your Messages</h1><p className="muted-text">Chat directly with buyers and sellers on campus.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="chat-layout">
      <aside className="conversation-list"><h2>Conversations</h2>{loading ? <p className="muted-text">Loading…</p> : conversations.length === 0 ? <p className="muted-text">No conversations yet. Start one from a marketplace listing.</p> : conversations.map((conversation) => <button key={conversation._id} type="button" className={`conversation-item ${activeId === conversation._id ? "active" : ""}`} onClick={() => navigate(`/messages?conversation=${conversation._id}`)}><strong>{otherParticipant(conversation)?.name || "Campus member"}{conversation.unreadCount > 0 && <span className="chat-unread-badge" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</span>}</strong><span>{conversation.listing?.title || "Listing"}</span><small>{conversation.lastMessage?.attachment ? `📎 ${conversation.lastMessage.attachment.filename}` : conversation.lastMessage?.text || "Start a conversation"}</small></button>)}</aside>
      <section className="chat-thread">{activeConversation ? <><header className="chat-thread-header"><div className="chat-peer-heading"><span className={`presence-dot ${peerOnline ? "online" : "offline"}`} aria-label={peerOnline ? "Online" : "Offline"} /><h2>{otherParticipant(activeConversation)?.name || "Campus member"}</h2></div><p className="chat-peer-status" aria-live="polite">{peerTyping ? "Typing..." : peerOnline ? "Online" : "Offline"}</p><p>{activeConversation.listing?.title || "Marketplace listing"}</p><form className="chat-search-form" onSubmit={searchConversation}><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} maxLength={100} placeholder="Search this conversation" aria-label="Search messages" /><button type="submit" disabled={searching || !searchQuery.trim()}>{searching ? "Searching…" : "Search"}</button>{searchResults && <button type="button" onClick={() => setSearchResults(null)}>Close</button>}</form></header>{searchResults && <div className="chat-search-results"><strong>{searchResults.length} result{searchResults.length === 1 ? "" : "s"}</strong>{searchResults.length === 0 ? <small>No messages found.</small> : searchResults.map((message) => <button key={message._id} type="button" onClick={() => jumpToMessage(message)}><span>{message.sender?.name || "Student"} · {new Date(message.createdAt).toLocaleString()}</span><small>{message.text || message.attachment?.filename || "Attachment"}</small></button>)}</div>}<div className="chat-messages" ref={messagesViewportRef} onScroll={(event) => { const node = event.currentTarget; shouldAutoScrollRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 140; }}>{messages.map((message, index) => { const mine = normalizeId(message.sender) === normalizeId(myId); const deleted = Boolean(message.deletedAt); const edited = Boolean(message.editedAt) && !deleted; const receipt = message.readAt ? "read" : message.deliveredAt ? "delivered" : "sent"; const previous = messages[index - 1]; const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString(); const reactionGroups = (message.reactions || []).reduce((groups, reaction) => { groups[reaction.emoji] = (groups[reaction.emoji] || 0) + 1; return groups; }, {}); return <React.Fragment key={normalizeId(message._id)}>{newDay && <div className="chat-date-separator"><span>{chatDayLabel(message.createdAt)}</span></div>}<article ref={(node) => { if (node) messageElementsRef.current.set(normalizeId(message._id), node); else messageElementsRef.current.delete(normalizeId(message._id)); }} className={`chat-message ${mine ? "mine" : "theirs"} ${highlightedMessageId === normalizeId(message._id) ? "highlighted" : ""}`}><div className="chat-bubble">{message.replyTo && <button type="button" className="chat-reply-quote" onClick={() => { const target = messageElementsRef.current.get(normalizeId(message.replyTo._id)); target?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><strong>{message.replyTo.sender?.name || "Student"}</strong><span>{message.replyTo.deletedAt ? "This message was deleted" : message.replyTo.text || message.replyTo.attachment?.filename || "Attachment"}</span></button>}{message.isForwarded && !deleted && <small className="chat-forwarded-label">↗ Forwarded</small>}{deleted ? <p>This message was deleted</p> : <>{message.text && <p>{message.text}</p>}{message.attachment && <SecureAttachment attachment={message.attachment} onError={setError} />}</>}<small className="chat-message-meta"><span>{mine ? "You" : message.sender?.name || "Student"}{edited ? " · edited" : ""} · {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>{mine && <span className={`message-receipt ${receipt}`} aria-label={receipt === "read" ? "Read" : receipt === "delivered" ? "Delivered" : "Sent"} title={receipt === "read" ? "Read" : receipt === "delivered" ? "Delivered" : "Sent"}>{receipt === "sent" ? "✓" : "✓✓"}</span>}</small></div>{Object.entries(reactionGroups).length > 0 && <div className="chat-reactions">{Object.entries(reactionGroups).map(([emoji, count]) => <button key={emoji} type="button" onClick={() => reactToMessage(message, emoji)} aria-label={`${emoji} ${count} reactions`}>{emoji} {count}</button>)}</div>}<div className="message-actions">{!deleted && <><button type="button" onClick={() => setReactionPickerFor(reactionPickerFor === normalizeId(message._id) ? "" : normalizeId(message._id))}>React</button>{reactionPickerFor === normalizeId(message._id) && <span className="chat-reaction-picker">{allowedReactions.map((emoji) => <button key={emoji} type="button" onClick={() => reactToMessage(message, emoji)}>{emoji}</button>)}</span>}</>}{mine && !deleted && <><button type="button" onClick={() => editMessage(message)}>Edit</button><button type="button" onClick={() => removeMessage(message)}>Delete</button></>}</div></article></React.Fragment>; })}<div ref={bottomRef} /></div><form className="chat-compose" onSubmit={send}>
        {selectedFile && <div className="chat-upload-preview">{previewUrl ? <img src={previewUrl} alt="Selected attachment preview" /> : <span className="chat-attachment-file-icon">PDF</span>}<div><strong>{selectedFile.name}</strong><span>{selectedFile.type === "application/pdf" ? "PDF document" : `${selectedFile.type.split("/")[1].toUpperCase()} image`} · {formatFileSize(selectedFile.size)}</span></div><button type="button" onClick={() => { setSelectedFile(null); setUploadProgress(null); }}>Remove</button></div>}
        {uploadProgress !== null && <div className="chat-upload-progress" role="status"><span>{uploadProgress < 100 ? `Uploading ${uploadProgress}%` : "Saving attachment…"}</span><progress max="100" value={uploadProgress} /></div>}
        <div className="chat-compose-row"><label className={`chat-attach-button ${sending ? "disabled" : ""}`} title="Attach image or PDF">📎<span>Attach</span><input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={selectFile} disabled={sending} aria-label="Attach an image or PDF" /></label><input value={draft} onChange={changeDraft} maxLength={4000} placeholder="Write a message…" aria-label="Write a message" /><button type="submit" className="button button-primary" disabled={sending || (!draft.trim() && !selectedFile)}>{sending ? "Sending…" : "Send"}</button></div>
      </form></> : <div className="chat-empty"><span>💬</span><h2>Choose a conversation</h2><p>Your messages with other students will appear here.</p></div>}</section>
    </section>
  </main></div>;
}

// ============================================================
// SELL ITEM MODAL
// ============================================================

function SellModal({ onClose, onAddProduct, currentBlock }) {
  const [form, setForm] = useState({
    title: "",
    category: "Books",
    price: "",
    condition: "Good",
    seller: "",
    contact: "",
    description: "",
  });

  const [image, setImage] = useState("");
  const [error, setError] = useState("");

  function change(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  function imageChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    readImageFile(
      file,
      (value) => {
        setImage(value);
        setError("");
      },
      setError
    );

    event.target.value = "";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (
      !form.title.trim() ||
      !form.seller.trim() ||
      !form.contact.trim() ||
      !form.price ||
      Number(form.price) <= 0
    ) {
      setError(
        "Please complete all required fields with a valid price."
      );
      return;
    }

    const digits = form.contact.replace(/\D/g, "");

    if (digits.length < 10 || digits.length > 15) {
      setError("Please enter a valid contact number.");
      return;
    }

    const product = {
      ...form,
      id: Date.now(),
      image,
      title: form.title.trim(),
      seller: form.seller.trim(),
      contact: form.contact.trim(),
      price: Number(form.price),
      description: form.description.trim(),
      emoji: EMOJIS[form.category] || "📦",
      block: currentBlock || "Unassigned",
    };

    try {
      if (await onAddProduct(product)) onClose();
    } catch (requestError) {
      setError(requestError.message || "Unable to publish listing.");
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="sell-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sell-modal-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">LIST SOMETHING NEW</p>
            <h2 id="sell-modal-title">Sell an item</h2>

            <p>
              Give your unused items a new home.
              {currentBlock
                ? ` Listing in ${currentBlock} Block.`
                : ""}
            </p>
          </div>

          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="sell-form" onSubmit={submit}>
          <label htmlFor="item-image">Upload Item Image</label>

          <label className="image-upload-box" htmlFor="item-image">
            {image ? (
              <img
                src={image}
                alt="Item preview"
                className="uploaded-item-preview"
              />
            ) : (
              <div className="upload-placeholder">
                <span className="upload-icon">📷</span>
                <strong>Click to upload an image</strong>
                <span>PNG, JPG or WEBP · Maximum 2 MB</span>
              </div>
            )}
          </label>

          <input
            id="item-image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="image-file-input"
            onChange={imageChange}
          />

          {image && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setImage("")}
            >
              Remove Image
            </button>
          )}

          <label htmlFor="item-title">Item name *</label>

          <input
            id="item-title"
            name="title"
            value={form.title}
            onChange={change}
            placeholder="Engineering Mathematics Book"
            required
          />

          <div className="form-row">
            <div>
              <label htmlFor="item-category">Category *</label>

              <select
                id="item-category"
                name="category"
                value={form.category}
                onChange={change}
              >
                {CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="item-price">Price (₹) *</label>

              <input
                id="item-price"
                name="price"
                type="number"
                min="1"
                value={form.price}
                onChange={change}
                placeholder="250"
                required
              />
            </div>
          </div>

          <label htmlFor="item-condition">Condition</label>

          <select
            id="item-condition"
            name="condition"
            value={form.condition}
            onChange={change}
          >
            <option>New</option>
            <option>Like New</option>
            <option>Good</option>
            <option>Fair</option>
          </select>

          <label htmlFor="seller-name">Your name *</label>

          <input
            id="seller-name"
            name="seller"
            value={form.seller}
            onChange={change}
            placeholder="Enter your name"
            required
          />

          <label htmlFor="seller-contact">Contact Number *</label>

          <input
            id="seller-contact"
            name="contact"
            type="tel"
            value={form.contact}
            onChange={(event) => {
              if (/^[0-9+\-\s()]*$/.test(event.target.value)) {
                change(event);
              }
            }}
            placeholder="Enter your mobile number"
            required
          />

          <label htmlFor="item-description">Description</label>

          <textarea
            id="item-description"
            name="description"
            value={form.description}
            onChange={change}
            placeholder="Tell buyers about your item..."
            rows="3"
          />

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="modal-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
            >
              Cancel
            </button>

            <button type="submit" className="button button-primary">
              Publish Listing →
            </button>
          </div>

          <p className="form-note">
            Listings are saved to the Campus Exchange marketplace.
          </p>
        </form>
      </section>
    </div>
  );
}

// ============================================================
// EDIT ITEM MODAL
// ============================================================

function EditItemModal({ product, onClose, onSave }) {
  const [form, setForm] = useState({
    title: product.title || "",
    category: product.category || "Books",
    price: String(product.price ?? ""),
    condition: product.condition || "Good",
    seller: product.seller || "",
    contact: product.contact || "",
    description: product.description || "",
  });

  const [image, setImage] = useState(product.image || "");
  const [error, setError] = useState("");

  function change(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  function imageChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    readImageFile(
      file,
      (value) => {
        setImage(value);
        setError("");
      },
      setError
    );

    event.target.value = "";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (
      !form.title.trim() ||
      !form.seller.trim() ||
      !form.contact.trim() ||
      !form.price ||
      Number(form.price) <= 0
    ) {
      setError(
        "Please complete all required fields with a valid price."
      );
      return;
    }

    const digits = form.contact.replace(/\D/g, "");

    if (digits.length < 10 || digits.length > 15) {
      setError("Please enter a valid contact number.");
      return;
    }

    const updated = {
      ...product,
      ...form,
      id: product.id,
      image,
      title: form.title.trim(),
      seller: form.seller.trim(),
      contact: form.contact.trim(),
      price: Number(form.price),
      description: form.description.trim(),
      emoji: EMOJIS[form.category] || "📦",
      block: product.block || "Unassigned",
    };

    try {
      if (await onSave(updated)) onClose();
    } catch (requestError) {
      setError(requestError.message || "Unable to update listing.");
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="sell-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-item-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">MANAGE LISTING</p>
            <h2 id="edit-item-title">Edit item</h2>
            <p>Update the item's information below.</p>
          </div>

          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="sell-form" onSubmit={submit}>
          <label htmlFor="edit-item-image">Item image</label>

          <label
            className="image-upload-box"
            htmlFor="edit-item-image"
          >
            {image ? (
              <img
                src={image}
                alt="Item preview"
                className="uploaded-item-preview"
              />
            ) : (
              <div className="upload-placeholder">
                <span className="upload-icon">📷</span>
                <strong>Upload an item image</strong>
                <span>PNG, JPG or WEBP · Maximum 2 MB</span>
              </div>
            )}
          </label>

          <input
            id="edit-item-image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="image-file-input"
            onChange={imageChange}
          />

          {image && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setImage("")}
            >
              Remove Image
            </button>
          )}

          <label htmlFor="edit-item-name">Item name *</label>

          <input
            id="edit-item-name"
            name="title"
            value={form.title}
            onChange={change}
            required
          />

          <div className="form-row">
            <div>
              <label htmlFor="edit-category">Category *</label>

              <select
                id="edit-category"
                name="category"
                value={form.category}
                onChange={change}
              >
                {CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="edit-price">Price (₹) *</label>

              <input
                id="edit-price"
                name="price"
                type="number"
                min="1"
                value={form.price}
                onChange={change}
                required
              />
            </div>
          </div>

          <label htmlFor="edit-condition">Condition *</label>

          <select
            id="edit-condition"
            name="condition"
            value={form.condition}
            onChange={change}
          >
            <option>New</option>
            <option>Like New</option>
            <option>Good</option>
            <option>Fair</option>
          </select>

          <label htmlFor="edit-seller">User name *</label>

          <input
            id="edit-seller"
            name="seller"
            value={form.seller}
            onChange={change}
            required
          />

          <label htmlFor="edit-contact">Phone number *</label>

          <input
            id="edit-contact"
            name="contact"
            type="tel"
            value={form.contact}
            onChange={(event) => {
              if (/^[0-9+\-\s()]*$/.test(event.target.value)) {
                change(event);
              }
            }}
            required
          />

          <label htmlFor="edit-description">Description</label>

          <textarea
            id="edit-description"
            name="description"
            value={form.description}
            onChange={change}
            rows="4"
          />

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="modal-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
            >
              Cancel
            </button>

            <button type="submit" className="button button-primary">
              Save Changes →
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

// ============================================================
// SHARED LISTING ACTIONS
// ============================================================

function useListingActions(setProducts, useApi = false, isAdmin = false) {
  async function updateProduct(updated) {
    if (useApi) {
      const data = await listingRequest(
        isAdmin ? `/admin/${updated.id}` : `/${updated.id}`,
        {
        method: "PUT",
        body: listingPayload(updated),
      });
      const saved = normalizeListing(data.listing);
      setProducts((current) => current.map((product) => product.id === saved.id ? saved : product));
      return true;
    }
    const current = readProducts();

    const next = current.map((product) =>
      product.id === updated.id ? updated : product
    );

    if (!saveProducts(next)) return false;

    setProducts(next);
    return true;
  }

  async function deleteProduct(id) {
    if (useApi) {
      const item = window.confirm("Delete this listing? This cannot be undone.");
      if (!item) return false;
      try {
        await listingRequest(
          isAdmin ? `/admin/${id}` : `/${id}`,
          { method: "DELETE" }
        );
        setProducts((products) => products.filter((product) => product.id !== id));
        return true;
      } catch (error) {
        alert(error.message || "Unable to delete listing.");
        return false;
      }
    }
    const current = readProducts();

    const item = current.find((product) => product.id === id);

    if (
      !item ||
      !window.confirm(
        `Are you sure you want to delete "${item.title}"?`
      )
    ) {
      return false;
    }

    const next = current.filter((product) => product.id !== id);

    if (!saveProducts(next)) return false;

    setProducts(next);
    return true;
  }

  return {
    updateProduct,
    deleteProduct,
  };
}

// ============================================================
// MARKETPLACE
// ============================================================

function Marketplace() {
  const isAdmin = sessionStorage.getItem(ADMIN_AUTH_KEY) === "true";
  const location = useLocation();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [listingsError, setListingsError] = useState("");
  const [listingsLoading, setListingsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [showSell, setShowSell] = useState(false);
  const [sortOrder, setSortOrder] = useState("newest");
  const [selectedBlock, setSelectedBlock] = useState("");
  const [editing, setEditing] = useState(null);

  const actions = useListingActions(setProducts, true, isAdmin);

  async function startChat(product) {
    const token = currentToken();
    if (!token) {
      navigate("/login");
      return;
    }

    const listingId = product?._id || product?.id;
    if (!listingId || !/^[a-f\d]{24}$/i.test(String(listingId))) {
      alert("This listing is not available for chat yet. Please refresh the marketplace.");
      return;
    }

    try {
      const data = await chatRequest("/conversations", {
        method: "POST",
        body: JSON.stringify({ listingId }),
      });
      const conversationId = data.conversation?._id;
      if (!conversationId) throw new Error("The server did not return a conversation.");
      navigate(`/messages?conversation=${conversationId}`);
    } catch (error) {
      alert(error.message || "Unable to start this conversation.");
    }
  }

  useEffect(() => {
    let active = true;
    fetchListings()
      .then((listings) => { if (active) setProducts(listings); })
      .catch((error) => { if (active) setListingsError(error.message || "Unable to load listings."); })
      .finally(() => { if (active) setListingsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);

    const raw = (params.get("block") || "").toUpperCase();

    const block = BLOCKS.includes(raw) ? raw : "";

    setSelectedBlock(block);

    if (params.get("intent") === "sell") {
      setShowSell(true);

      navigate(
        block ? `/marketplace?block=${block}` : "/marketplace",
        { replace: true }
      );
    }
  }, [location.search, navigate]);

  async function addProduct(product) {
    const data = await listingRequest("/", {
      method: "POST",
      body: listingPayload({ ...product, block: selectedBlock || product.block || "Unassigned" }),
    });
    setProducts((current) => [normalizeListing(data.listing), ...current]);
    setSearch("");
    setActiveCategory("All");
    setSortOrder("newest");

    return true;
  }

  const filtered = products
    .filter(
      (product) =>
        (activeCategory === "All" ||
          product.category === activeCategory) &&
        [
          product.title,
          product.category,
          product.description,
          product.seller,
          product.block,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        )
    )
    .sort((a, b) =>
      sortOrder === "low"
        ? Number(a.price) - Number(b.price)
        : sortOrder === "high"
          ? Number(b.price) - Number(a.price)
          : new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

  return (
    <div className="app-page">
      <Header />

      <main className="marketplace-main">
        <section className="marketplace-banner">
          <div>
            <p className="eyebrow">VIGNAN UNIVERSITY</p>

            <h1>
              Discover your next <span>great find.</span>
            </h1>

            <p>
              Shop smarter, save more, and find useful things from your
              campus community.
            </p>
          </div>

          <div className="marketplace-banner-art">🛍️</div>
        </section>

        <div className="marketplace-title-row">
          <div>
            <p className="eyebrow">THE CAMPUS MARKETPLACE</p>
            <h2>Explore listings</h2>

            <p className="muted-text">
              {filtered.length} item
              {filtered.length !== 1 ? "s" : ""} available
            </p>
          </div>

          {!isAdmin && (
            <button
              className="button button-primary"
              onClick={() => {
                setSelectedBlock("");
                setShowSell(true);
              }}
            >
              ＋ Sell an Item
            </button>
          )}
        </div>

        {listingsError && <p className="form-error" role="alert">{listingsError}</p>}

        <section className="marketplace-toolbar">
          <div className="search-box">
            <span>⌕</span>

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search books, electronics, accessories..."
              aria-label="Search marketplace"
            />

            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <select
            className="sort-select"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            aria-label="Sort listings"
          >
            <option value="newest">Newest first</option>
            <option value="low">Price: Low to High</option>
            <option value="high">Price: High to Low</option>
          </select>
        </section>

        <div className="category-list">
          {["All", ...CATEGORIES].map((category) => (
            <button
              key={category}
              className={
                activeCategory === category
                  ? "category-button active"
                  : "category-button"
              }
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {listingsLoading ? <p className="muted-text">Loading listings…</p> : filtered.length ? (
          <section className="product-grid">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={isAdmin || product.owner?._id === sessionStorage.getItem("campusExchangeStudentId") ? setEditing : undefined}
                onDelete={isAdmin || product.owner?._id === sessionStorage.getItem("campusExchangeStudentId") ? actions.deleteProduct : undefined}
                onChat={!isAdmin && product.owner?._id !== sessionStorage.getItem("campusExchangeStudentId") ? () => startChat(product) : undefined}
              />
            ))}
          </section>
        ) : (
          <section className="empty-state">
            <div>🔎</div>
            <h3>No items found</h3>
            <p>Try another search or select a different category.</p>

            <button
              className="button button-secondary"
              onClick={() => {
                setSearch("");
                setActiveCategory("All");
              }}
            >
              Clear filters
            </button>
          </section>
        )}

        <section className="marketplace-help">
          <div className="help-icon">💡</div>

          <div>
            <h3>Have something you no longer need?</h3>
            <p>Help another student find it by creating a listing.</p>
          </div>

          <button
            className="button button-secondary"
            onClick={() => {
              setSelectedBlock("");
              setShowSell(true);
            }}
          >
            List your item →
          </button>
        </section>
      </main>

      <footer className="site-footer">
        <span>© 2026 Campus Exchange</span>
        <span>Vignan University student marketplace</span>
      </footer>

      {showSell && (
        <SellModal
          currentBlock={selectedBlock}
          onClose={() => setShowSell(false)}
          onAddProduct={addProduct}
        />
      )}

      {editing && (
        <EditItemModal
          key={editing.id}
          product={editing}
          onClose={() => setEditing(null)}
          onSave={actions.updateProduct}
        />
      )}
    </div>
  );
}

// ============================================================
// ADMIN LOGIN
// ============================================================

function AdminLogin() {
  const navigate = useNavigate();

  const [stage, setStage] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  function changeStage(nextStage) {
    setStage(nextStage);
    setError("");
    setNotice("");
  }

  // API request helper
  async function authRequest(endpoint, payload) {
    const response = await apiFetch(
      `${API_BASE_URL}/auth/${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message || `Request failed (${response.status}).`
      );
    }

    return data;
  }

  // Form submission
  async function submit(event) {
    event.preventDefault();

    setError("");
    setNotice("");
    setLoading(true);

    try {
      // STEP 1: FORGOT PASSWORD
      if (stage === "forgot") {
        await authRequest(
          "admin/forgot-password",
          {
            email: email.trim(),
          }
        );

        setStage("reset");

        setNotice(
          "If an admin account exists for this email, a password reset OTP has been sent."
        );

        return;
      }

      // STEP 2: RESET PASSWORD
      if (stage === "reset") {
        if (!/^\d{6}$/.test(otp.trim())) {
          throw new Error(
            "Enter the 6-digit password reset OTP."
          );
        }

        if (newPassword.length < 8) {
          throw new Error(
            "New password must contain at least 8 characters."
          );
        }

        if (newPassword !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        await authRequest(
          "admin/reset-password",
          {
            email: email.trim(),
            otp: otp.trim(),
            newPassword,
          }
        );

        setStage("login");
        setOtp("");
        setPassword("");
        setNewPassword("");
        setConfirmPassword("");

        setNotice(
          "Admin password reset successfully. Please log in with your new password."
        );

        return;
      }

      // STEP 3: ADMIN LOGIN
      const data = await authRequest(
        "login",
        {
          email: email.trim(),
          password,
        }
      );

      // Check admin role
      if (data.user?.role !== "admin") {
        throw new Error(
          "Access denied. Admin account required."
        );
      }

      // Keep admin and student sessions separate.
      sessionStorage.removeItem(STUDENT_AUTH_KEY);
      sessionStorage.removeItem("campusExchangeStudentEmail");
      sessionStorage.removeItem("campusExchangeStudentId");
      sessionStorage.setItem(ADMIN_AUTH_KEY, "true");
      sessionStorage.setItem("adminToken", data.token);
      sessionStorage.setItem(
        "campusExchangeToken",
        data.token
      );

      // Navigate to dashboard
      navigate("/admin/dashboard", {
        replace: true,
      });

    } catch (requestError) {
      console.error(
        "Admin authentication error:",
        requestError
      );

      setError(
        requestError.message ||
        "Unable to connect to the server. Please try again."
      );

    } finally {
      setLoading(false);
    }
  }

  // Dynamic heading
  const heading =
    stage === "forgot"
      ? "Forgot Password"
      : stage === "reset"
      ? "Reset Admin Password"
      : "Admin login";

  // Dynamic description
  const description =
    stage === "forgot"
      ? "Enter your registered admin email address to receive a reset code."
      : stage === "reset"
      ? `Enter the 6-digit OTP sent to ${email} and choose a new password.`
      : "Sign in to manage marketplace listings.";

  return (
    <main className="auth-page">
      <section className="auth-card">

        {/* BRAND */}
        <Link to="/login" className="auth-brand">
          <span className="brand-icon">C</span>

          <span>
            <strong>Campus Exchange</strong>
            <small>Administration Portal</small>
          </span>
        </Link>

        {/* HEADING */}
        <div className="auth-heading">
          <div className="auth-emoji">
            {stage === "login" ? "🛡️" : "🔐"}
          </div>

          <p className="eyebrow">ADMINISTRATION</p>

          <h1>{heading}</h1>

          <p>{description}</p>
        </div>

        {/* FORM */}
        <form className="auth-form" onSubmit={submit}>

          {/* ADMIN EMAIL */}
          <label htmlFor="admin-email">
            Admin email
          </label>

          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="Enter admin email"
            autoComplete="email"
            readOnly={stage === "reset"}
            required
          />

          {/* LOGIN PASSWORD */}
          {stage === "login" && (
            <>
              <label htmlFor="admin-password">
                Password
              </label>

              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter admin password"
                autoComplete="current-password"
                required
              />

              {/* FORGOT PASSWORD LINK */}
              <button
                type="button"
                className="forgot-password-link"
                onClick={() => changeStage("forgot")}
              >
                Forgot password?
              </button>
            </>
          )}

          {/* RESET PASSWORD FIELDS */}
          {stage === "reset" && (
            <>
              <label htmlFor="admin-reset-otp">
                Password reset OTP
              </label>

              <input
                id="admin-reset-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) =>
                  setOtp(
                    event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6)
                  )
                }
                placeholder="Enter 6-digit OTP"
                maxLength={6}
                required
              />

              <label htmlFor="admin-new-password">
                New password
              </label>

              <input
                id="admin-new-password"
                type="password"
                value={newPassword}
                onChange={(event) =>
                  setNewPassword(event.target.value)
                }
                placeholder="Enter new password"
                autoComplete="new-password"
                minLength={8}
                required
              />

              <label htmlFor="admin-confirm-password">
                Confirm new password
              </label>

              <input
                id="admin-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                placeholder="Re-enter new password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </>
          )}

          {/* SUCCESS MESSAGE */}
          {notice && (
            <p className="password-success" role="status">
              {notice}
            </p>
          )}

          {/* ERROR MESSAGE */}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {/* SUBMIT BUTTON */}
          <button
            type="submit"
            className="button button-primary full-width"
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : stage === "forgot"
              ? "Send Reset OTP →"
              : stage === "reset"
              ? "Reset Password →"
              : "Sign In to Dashboard →"}
          </button>

        </form>

        {/* FOOTER */}
        {stage !== "login" ? (
          <p className="auth-footer">
            <button
              type="button"
              onClick={() => {
                changeStage("login");
                setOtp("");
                setNewPassword("");
                setConfirmPassword("");
              }}
            >
              ← Back to admin login
            </button>
          </p>
        ) : (
          <p className="auth-footer">
            <Link to="/login">
              ← Back to student login
            </Link>
          </p>
        )}

      </section>
    </main>
  );
}
// ============================================================
// ADMIN DASHBOARD
// ============================================================

function AdminDashboard() {
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null);

  const actions = useListingActions(setProducts, true, true);

  // Fetch listings from MongoDB through backend API
  useEffect(() => {
    let active = true;

    async function loadListings() {
      try {
        setLoading(true);
        setLoadError("");

        const listings = await fetchListings();

        if (active) {
          setProducts(listings);
        }
      } catch (error) {
        console.error("Failed to load admin listings:", error);

        if (active) {
          setLoadError(
            error.message || "Unable to load listings."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadListings();

    window.addEventListener("focus", loadListings);

    return () => {
      active = false;
      window.removeEventListener("focus", loadListings);
    };
  }, []);

  // Admin logout
  function logout() {
    sessionStorage.removeItem(ADMIN_AUTH_KEY);
    sessionStorage.removeItem("adminToken");
    sessionStorage.removeItem("campusExchangeToken");

    navigate("/admin/login", { replace: true });
  }

  const total = products.reduce(
    (sum, product) => sum + Number(product.price || 0),
    0
  );

  return (
    <div className="admin-layout">

      {/* SIDEBAR */}
      <aside className="admin-sidebar">

        <Link to="/admin/dashboard" className="admin-brand">
          <span className="brand-icon">C</span>
          <span>Campus Exchange</span>
        </Link>

        <p className="admin-menu-label">ADMINISTRATION</p>

        <div className="admin-menu-item active">
          <span>▦</span> Dashboard
        </div>

        <Link to="/marketplace" className="admin-menu-item">
          <span>🛍️</span> Marketplace
        </Link>

        <button className="admin-menu-item" onClick={logout}>
          <span>↪</span> Log out
        </button>

        <div className="admin-sidebar-footer">
          <span className="admin-avatar">A</span>

          <div>
            <strong>Administrator</strong>
            <small>Admin account</small>
          </div>
        </div>

      </aside>

      {/* MAIN DASHBOARD */}
      <main className="admin-main">

        <div className="admin-topbar">
          <div>
            <p className="eyebrow">OVERVIEW</p>
            <h1>Admin dashboard</h1>
            <p>Manage Campus Exchange listings.</p>
          </div>

          <button
            className="button button-secondary"
            onClick={logout}
          >
            Log out
          </button>
        </div>

        {/* STATISTICS */}
        <section className="admin-stat-grid">

          <article className="admin-stat-card">
            <span className="stat-icon">📦</span>
            <p>Total listings</p>
            <h2>{products.length}</h2>
            <small>Items currently listed</small>
          </article>

          <article className="admin-stat-card">
            <span className="stat-icon">₹</span>
            <p>Total listed value</p>
            <h2>₹{total.toLocaleString("en-IN")}</h2>
            <small>Combined asking prices</small>
          </article>

          <article className="admin-stat-card">
            <span className="stat-icon">🎓</span>
            <p>Marketplace</p>
            <h2>Active</h2>
            <small>Live marketplace status</small>
          </article>

        </section>

        {/* LISTINGS TABLE */}
        <section className="admin-table-section">

          <div className="admin-table-heading">
            <div>
              <h2>Marketplace listings</h2>
              <p>Edit or delete marketplace items.</p>
            </div>

            <Link
              to="/marketplace"
              className="button button-primary"
            >
              View marketplace →
            </Link>
          </div>

          {loading ? (

            <p className="muted-text">
              Loading listings from the server...
            </p>

          ) : loadError ? (

            <p className="form-error" role="alert">
              {loadError}
            </p>

          ) : products.length ? (

            <div className="table-scroll">

              <table className="admin-table">

                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Block</th>
                    <th>Category</th>
                    <th>Seller</th>
                    <th>Price</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>

                  {products.map((product) => (

                    <tr key={product.id}>

                      <td>
                        <div className="table-product">

                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.title}
                              style={{
                                width: 36,
                                height: 36,
                                objectFit: "cover",
                                borderRadius: 8,
                              }}
                            />
                          ) : (
                            <span>
                              {product.emoji || "📦"}
                            </span>
                          )}

                          <strong>{product.title}</strong>

                        </div>
                      </td>

                      <td>{product.block || "Unassigned"}</td>

                      <td>{product.category}</td>

                      <td>{product.seller}</td>

                      <td>
                        ₹{Number(product.price).toLocaleString("en-IN")}
                      </td>

                      <td>
                        <div className="admin-row-actions">

                          <button
                            className="button button-secondary"
                            onClick={() => setEditing(product)}
                          >
                            Edit
                          </button>

                          <button
                            className="button button-danger"
                            onClick={() =>
                              actions.deleteProduct(product.id)
                            }
                          >
                            Delete
                          </button>

                        </div>
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          ) : (

            <div className="empty-state">
              <div>📦</div>
              <h3>No listings available</h3>
              <p>New listings will appear here.</p>
            </div>

          )}

        </section>

        {/* BACKEND STATUS MESSAGE */}
        <p className="admin-notice">
          Marketplace listings are loaded and managed through
          the Campus Exchange backend.
        </p>

      </main>

      {/* EDIT MODAL */}
      {editing && (
        <EditItemModal
          key={editing.id}
          product={editing}
          onClose={() => setEditing(null)}
          onSave={actions.updateProduct}
        />
      )}

    </div>
  );
}
// ============================================================
// CAMPUS BLOCKS
// ============================================================

function CampusBlocks() {
  const navigate = useNavigate();

  return (
    <div className="app-page">
      <Header />

      <main className="campus-blocks-main">
        <div className="campus-blocks-heading">
          <div>
            <p className="eyebrow">VIGNAN UNIVERSITY</p>
            <h1>Campus Blocks</h1>
            <p>Select a block to open its dashboard.</p>
          </div>

          <span className="campus-count">5 Blocks</span>
        </div>

        <section className="campus-blocks-grid">
          {BLOCKS.map((block) => (
            <button
              type="button"
              className="campus-block-card"
              key={block}
              onClick={() =>
                navigate(`/campus-blocks/${block}`)
              }
            >
              <div className="campus-block-card-top">
                <div className="campus-block-icon">{block}</div>
                <span className="campus-block-arrow">↗</span>
              </div>

              <h3>{block} Block</h3>

              <p className="campus-block-description">
                Explore {block} Block listings.
              </p>

              <span className="campus-block-explore">
                View Dashboard →
              </span>
            </button>
          ))}
        </section>
      </main>

      <footer className="site-footer">
        <span>© 2026 Campus Exchange</span>
        <span>Vignan University</span>
      </footer>
    </div>
  );
}

// ============================================================
// CAMPUS BLOCK DASHBOARD
// ============================================================

function CampusBlockDashboard() {
  const { block } = useParams();
  const navigate = useNavigate();

  const currentBlock = block?.toUpperCase();

  const [products, setProducts] = useState([]);
  const [listingsError, setListingsError] = useState("");
  const [listingsLoading, setListingsLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const actions = useListingActions(setProducts, true);

  async function startChat(product) {
    try {
      const data = await chatRequest("/conversations", { method: "POST", body: JSON.stringify({ listingId: product.id }) });
      navigate(`/messages?conversation=${data.conversation._id}`);
    } catch (error) {
      alert(error.message || "Unable to start this conversation.");
    }
  }

  useEffect(() => {
    let active = true;
    setListingsLoading(true);
    setListingsError("");
    fetchListings()
      .then((listings) => { if (active) setProducts(listings); })
      .catch((error) => { if (active) setListingsError(error.message || "Unable to load listings."); })
      .finally(() => { if (active) setListingsLoading(false); });
    return () => { active = false; };
  }, [currentBlock]);

  if (!BLOCKS.includes(currentBlock)) {
    return <Navigate to="/campus-blocks" replace />;
  }

  const list = products
    .filter((product) => product.block === currentBlock)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const openSell = () => {
    navigate(`/marketplace?intent=sell&block=${currentBlock}`);
  };

  return (
    <div className="app-page">
      <Header />

      <main className="marketplace-main">
        <section className="marketplace-banner">
          <div>
            <p className="eyebrow">VIGNAN UNIVERSITY</p>

            <h1>
              {currentBlock} Block <span>Dashboard</span>
            </h1>

            <p>
              Explore items uploaded by students in {currentBlock} Block.
            </p>
          </div>

          <div className="marketplace-banner-art">🏫</div>
        </section>

        <div className="marketplace-title-row">
          <div>
            <p className="eyebrow">BLOCK MARKETPLACE</p>
            <h2>{currentBlock} Block Listings</h2>

            <p className="muted-text">
              {list.length} item{list.length !== 1 ? "s" : ""} available
            </p>
          </div>

          <button
            className="button button-primary"
            onClick={openSell}
          >
            ＋ Sell an Item
          </button>
        </div>

        {listingsError && <p className="form-error" role="alert">{listingsError}</p>}

        {listingsLoading ? <p className="muted-text">Loading listings…</p> : list.length ? (
          <section className="product-grid">
            {list.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={product.owner?._id === sessionStorage.getItem("campusExchangeStudentId") ? setEditing : undefined}
                onDelete={product.owner?._id === sessionStorage.getItem("campusExchangeStudentId") ? actions.deleteProduct : undefined}
                onChat={product.owner?._id !== sessionStorage.getItem("campusExchangeStudentId") ? () => startChat(product) : undefined}
              />
            ))}
          </section>
        ) : (
          <section className="empty-state">
            <div>📦</div>
            <h3>No items listed yet</h3>

            <p>
              Be the first to upload an item in {currentBlock} Block.
            </p>

            <button
              className="button button-primary"
              onClick={openSell}
            >
              ＋ Sell an Item
            </button>
          </section>
        )}

        <section className="marketplace-help">
          <div className="help-icon">🛍️</div>

          <div>
            <h3>Explore all campus listings</h3>
            <p>
              Discover items uploaded in every campus block.
            </p>
          </div>

          <button
            className="button button-secondary"
            onClick={() => navigate("/marketplace")}
          >
            Explore Listings →
          </button>
        </section>

        <button
          className="button button-secondary"
          onClick={() => navigate("/campus-blocks")}
        >
          ← Back to Campus Blocks
        </button>
      </main>

      <footer className="site-footer">
        <span>© 2026 Campus Exchange</span>
        <span>Vignan University</span>
      </footer>

      {editing && (
        <EditItemModal
          key={editing.id}
          product={editing}
          onClose={() => setEditing(null)}
          onSave={actions.updateProduct}
        />
      )}
    </div>
  );
}


// ============================================================
// APP ROUTES
// ============================================================

function AppRoutes() {
  return (
    <Routes>
      <Route path="/profiles-demo" element={<ProfileCardsDemo />} />

      <Route
        path="/"
        element={<Navigate to="/login" replace />}
      />

      <Route path="/login" element={<StudentLogin />} />

      <Route
        path="/welcome"
        element={
          <ProtectedStudentRoute>
            <StudentWelcome />
          </ProtectedStudentRoute>
        }
      />

      <Route
        path="/profile"
        element={
          <ProtectedStudentRoute>
            <StudentProfile />
          </ProtectedStudentRoute>
        }
      />

      <Route
        path="/marketplace"
        element={
          <ProtectedMarketplaceRoute>
            <Marketplace />
          </ProtectedMarketplaceRoute>
        }
      />

      <Route path="/messages" element={<ProtectedMarketplaceRoute><ChatCenter /></ProtectedMarketplaceRoute>} />

      <Route
        path="/chat"
        element={
          <ProtectedStudentRoute>
            <ChatCenter />
          </ProtectedStudentRoute>
        }
      />

      <Route
        path="/chat/:conversationId"
        element={
          <ProtectedStudentRoute>
            <ChatCenter />
          </ProtectedStudentRoute>
        }
      />

      <Route
        path="/campus-blocks"
        element={
          <ProtectedStudentRoute>
            <CampusBlocks />
          </ProtectedStudentRoute>
        }
      />

      <Route
        path="/campus-blocks/:block"
        element={
          <ProtectedStudentRoute>
            <CampusBlockDashboard />
          </ProtectedStudentRoute>
        }
      />

      <Route
        path="/admin/login"
        element={<AdminLogin />}
      />

      <Route
        path="/admin/dashboard"
        element={
          <ProtectedAdminRoute>
            <AdminDashboard />
          </ProtectedAdminRoute>
        }
      />

      <Route
        path="*"
        element={<Navigate to="/login" replace />}
      />
    </Routes>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
