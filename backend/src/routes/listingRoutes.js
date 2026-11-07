import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import adminMiddleware from "../middleware/adminMiddleware.js";

import {
  getListings,
  getMyListings,
  getListingById,
  createListing,
  editListing,
  removeListing,
  adminEditListing,
  adminRemoveListing,
} from "../controllers/listingController.js";

const router = express.Router();

// Public marketplace routes
router.get("/", getListings);
router.get("/mine", authMiddleware, getMyListings);

// Admin-only routes
router.put(
  "/admin/:id",
  authMiddleware,
  adminMiddleware,
  adminEditListing
);

router.delete(
  "/admin/:id",
  authMiddleware,
  adminMiddleware,
  adminRemoveListing
);

// Student listing actions
router.post("/", authMiddleware, createListing);
router.put("/:id", authMiddleware, editListing);
router.delete("/:id", authMiddleware, removeListing);

// Individual listing
router.get("/:id", getListingById);

export default router;