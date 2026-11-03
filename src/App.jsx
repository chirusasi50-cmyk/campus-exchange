import React, { useEffect, useState } from "react";
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
const checkPasswordStrength = (password) => {
  let score = 0;

  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { level: "Weak", score: 1 };
  if (score === 3) return { level: "Medium", score: 2 };
  if (score === 4) return { level: "Strong", score: 3 };

  return { level: "Very Strong", score: 4 };
};

const STUDENT_AUTH_KEY = "campusExchangeStudentDemo";
const ADMIN_AUTH_KEY = "campusExchangeAdminDemo";
const LISTINGS_KEY = "campusExchangeAdminListings";
const PROFILE_KEY = "campusExchangeStudentProfile";
const BLOCKS = ["A", "H", "N", "U", "P"];
const CATEGORIES = ["Books", "Electronics", "Accessories", "Other"];
const API_BASE_URL = `${import.meta.env.VITE_API_URL.replace(/\/$/, "")}/api`;

async function listingRequest(path, options = {}) {
const token =
  sessionStorage.getItem("adminToken") ||
  sessionStorage.getItem("campusExchangeToken");
  const response = await fetch(`${API_BASE_URL}/listings${path}`, {
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordStrength = checkPasswordStrength(password);
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";

  function switchMode(selectedMode) {
    setMode(selectedMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (isRegister) {
      if (!name.trim()) {
        setError("Please enter your full name.");
        return;
      }

      if (password.length < 8) {
        setError("Password must contain at least 8 characters.");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    try {
      setLoading(true);

      const endpoint = isRegister ? "register" : "login";

      const payload = isRegister
        ? {
            name: name.trim(),
            email: email.trim(),
            password,
          }
        : {
            email: email.trim(),
            password,
          };

      const response = await fetch(
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
          data.message ||
            (isRegister
              ? "Registration failed."
              : "Invalid email or password.")
        );
      }

      if (!data.token || !data.user) {
        throw new Error("Invalid authentication server response.");
      }

      // Store authentication token
      sessionStorage.setItem(
        "campusExchangeToken",
        data.token
      );

      sessionStorage.setItem(STUDENT_AUTH_KEY, "true");

      sessionStorage.setItem(
        "campusExchangeStudentEmail",
        data.user.email
      );
      sessionStorage.setItem("campusExchangeStudentId", data.user.id);

      // Store student profile
      localStorage.setItem(
        PROFILE_KEY,
        JSON.stringify({
          ...readProfile(),
          name: data.user.name,
          email: data.user.email,
        })
      );

      navigate("/welcome", { replace: true });

    } catch (err) {
      setError(
        err.message || "Unable to connect to the server."
      );
    } finally {
      setLoading(false);
    }
  }

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

        {/* HEADING */}
        <div className="auth-heading">

          <div className="auth-emoji">🎓</div>

          <p className="eyebrow">
            YOUR CAMPUS, YOUR COMMUNITY
          </p>

          <h1>
            {isRegister ? "Create Account" : "Welcome 😊"}
          </h1>

          <p>
            {isRegister
              ? "Create your account and join your campus community."
              : "Sign in to discover great deals and connect with students on your campus."}
          </p>

        </div>

        {/* FORM */}
        <form className="auth-form" onSubmit={submit}>

          {/* FULL NAME - REGISTER ONLY */}
          {isRegister && (
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
          />

          {/* PASSWORD */}
          <label htmlFor="student-password">
            Password
          </label>

          <div className="password-wrapper">

            <input
              id="student-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                isRegister
                  ? "Create a password"
                  : "Enter your password"
              }
              autoComplete={
                isRegister ? "new-password" : "current-password"
              }
              minLength={isRegister ? 8 : undefined}
              required
            />
          {isRegister && password && (() => {
  const passwordStrength = checkPasswordStrength(password);

  return (
    <div className="password-strength">
      <div className="strength-header">
        <span>Password Strength</span>
        <strong>{passwordStrength.level}</strong>
      </div>

      <div className="strength-bars">
        {[1, 2, 3, 4].map((bar) => (
          <div
            key={bar}
            className={`strength-bar ${
              bar <= passwordStrength.score
                ? `strength-${passwordStrength.score}`
                : ""
            }`}
          />
        ))}
      </div>

      {passwordStrength.score < 3 ? (
        <p className="password-hint">
          ⚠️ Use uppercase, lowercase, numbers and special characters.
        </p>
      ) : (
        <p className="password-success">
          ✓ Good password! Keep it secure.
        </p>
      )}
    </div>
  );
})()}  
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

          {/* CONFIRM PASSWORD - REGISTER ONLY */}
          {isRegister && (
            <>
              <label htmlFor="student-confirm-password">
                Confirm Password
              </label>

              <div className="password-wrapper">

                <input
                  id="student-confirm-password"
                  type={
                    showConfirmPassword ? "text" : "password"
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

          {/* ERROR */}
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
              ? isRegister
                ? "Creating account..."
                : "Signing in..."
              : isRegister
                ? "Create Account →"
                : "Login ←"}
          </button>

        </form>

        {/* FOOTER */}
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
    onSubmit={(e) => {
      e.preventDefault();
      alert(
        "Password changing requires backend authentication. Connect the password API to enable this feature securely."
      );
    }}
  >
    <div className="password-field">
      <label htmlFor="current-password">Current Password</label>
      <input
        id="current-password"
        type="password"
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
        placeholder="Confirm new password"
        autoComplete="new-password"
        minLength={8}
        required
      />
    </div>

    <button type="submit" className="button button-primary">
      🔒 Update Password
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

function ProductCard({ product, onEdit, onDelete }) {
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
          onClick={() =>
            product.contact
              ? (window.location.href = `tel:${product.contact.replace(
                  /[^\d+]/g,
                  ""
                )}`)
              : alert("No contact number is available for this listing.")
          }
        >
          Contact Seller
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

function useListingActions(setProducts, useApi = false) {
  async function updateProduct(updated) {
    if (useApi) {
      const data = await listingRequest(`/${updated.id}`, {
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
        await listingRequest(`/${id}`, { method: "DELETE" });
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

  const actions = useListingActions(setProducts, true);

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

          <button
            className="button button-primary"
            onClick={() => {
              setSelectedBlock("");
              setShowSell(true);
            }}
          >
            ＋ Sell an Item
          </button>
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
                onEdit={product.owner?._id === sessionStorage.getItem("campusExchangeStudentId") ? setEditing : undefined}
                onDelete={product.owner?._id === sessionStorage.getItem("campusExchangeStudentId") ? actions.deleteProduct : undefined}
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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim(),
            password: password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.message || "Invalid admin email or password."
        );
        return;
      }

      // Check whether the logged-in user is an admin
      if (data.user?.role !== "admin") {
        setError("Access denied. Admin account required.");
        return;
      }

      // Store authentication details
      sessionStorage.setItem(ADMIN_AUTH_KEY, "true");
      sessionStorage.setItem("adminToken", data.token);
      sessionStorage.setItem("campusExchangeToken", data.token);
      // Navigate to admin dashboard
      navigate("/admin/dashboard", {
        replace: true,
      });

    } catch (error) {
      console.error("Admin login error:", error);

      setError(
        "Unable to connect to the server. Please try again."
      );

    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">

        {/* Brand */}
        <Link to="/login" className="auth-brand">
          <span className="brand-icon">C</span>

          <span>
            <strong>Campus Exchange</strong>
            <small>Administration Portal</small>
          </span>
        </Link>

        {/* Heading */}
        <div className="auth-heading">
          <div className="auth-emoji">🛡️</div>

          <p className="eyebrow">ADMINISTRATION</p>

          <h1>Admin login</h1>

          <p>Sign in to manage marketplace listings.</p>
        </div>

        {/* Login Form */}
        <form className="auth-form" onSubmit={submit}>

          <label htmlFor="admin-email">
            Admin email
          </label>

          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter admin email"
            autoComplete="username"
            required
          />

          <label htmlFor="admin-password">
            Password
          </label>

          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter admin password"
            autoComplete="current-password"
            required
          />

          {/* Error Message */}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="button button-primary full-width"
            disabled={loading}
          >
            {loading
              ? "Signing in..."
              : "Sign In to Dashboard →"}
          </button>

        </form>

        {/* Footer */}
        <p className="auth-footer">
          <Link to="/login">
            ← Back to student login
          </Link>
        </p>

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

  const actions = useListingActions(setProducts, true);

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
          <ProtectedStudentRoute>
            <Marketplace />
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
